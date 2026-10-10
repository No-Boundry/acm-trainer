// memlimit.c — Windows 判题辅助进程。
// 对提交的程序施加时间限制 + 内存限制,并上报峰值内存。
//
// 用法:
//   memlimit.exe <limit_mb> <timeout_ms> <report_file> <exe [args...]>
//
// 行为:
//   - 子进程以 CREATE_SUSPENDED 创建,AssignProcessToJobObject 后恢复
//     (Job 仅用于 KILL_ON_JOB_CLOSE,保证辅助进程退出时子进程被清理)。
//   - 时间限制:轮询等待累计超过 timeout 即 TerminateProcess(TLE)。
//   - 内存限制:每 15ms 采样子进程提交内存(PrivateUsage),超过 limit 即强杀(MLE)。
//     退出后还会读取峰值提交内存(PeakPagefileUsage)供校验。
//   - 结束前把结果写入 report_file:
//       peak_kb=<峰值KB> exit_code=<退出码> timed_out=<0|1> mem_exceeded=<0|1>
//
// 说明:本机实测 Windows 的 Job 内存上限(JOB_OBJECT_LIMIT_JOB_MEMORY /
// PROCESS_MEMORY)只会让分配失败,不会终止进程,无法稳定判 MLE,故采用轮询采样。
//
// 编译(需 MinGW g++):g++ -O2 -municode memlimit.c -o memlimit.exe -lpsapi
#include <windows.h>
#include <psapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

int wmain(int argc, wchar_t **argv) {
  if (argc < 5) return 2;

  SIZE_T limitBytes = (SIZE_T)_wcstoui64(argv[1], NULL, 10) * 1024 * 1024;
  DWORD timeoutMs = (DWORD)_wcstoui64(argv[2], NULL, 10);
  const wchar_t *reportFile = argv[3];

  HANDLE job = CreateJobObjectW(NULL, NULL);
  if (!job) return 3;

  JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli;
  ZeroMemory(&jeli, sizeof(jeli));
  // Job 只用于 KILL_ON_JOB_CLOSE(辅助进程退出时保证子进程被清理)。
  // 内存限制不靠 JOB_OBJECT_LIMIT_* :本机实测 Job 内存上限只会让 VirtualAlloc
  // 失败(程序自行处理/崩溃),不会终止进程,无法稳定判 MLE。
  // 因此改为下面的"轮询采样 + 超限强杀"。
  jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli))) {
    CloseHandle(job);
    return 4;
  }

  // 拼接子进程命令行(argv[4..],带引号)
  size_t cmdLen = 0;
  for (int i = 4; i < argc; i++) cmdLen += wcslen(argv[i]) + 3;
  wchar_t *cmd = (wchar_t *)malloc((cmdLen + 1) * sizeof(wchar_t));
  if (!cmd) { CloseHandle(job); return 7; }
  cmd[0] = L'\0';
  for (int i = 4; i < argc; i++) {
    if (i > 4) wcscat(cmd, L" ");
    int hasSpace = wcschr(argv[i], L' ') != NULL || wcschr(argv[i], L'\t') != NULL;
    if (hasSpace) wcscat(cmd, L"\"");
    wcscat(cmd, argv[i]);
    if (hasSpace) wcscat(cmd, L"\"");
  }

  STARTUPINFOW si;
  ZeroMemory(&si, sizeof(si));
  si.cb = sizeof(si);
  // 显式继承本进程的标准句柄(node 已把 stdin/stdout/stderr 重定向到文件)
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  si.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  si.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION pi;
  ZeroMemory(&pi, sizeof(pi));

  // 继承本进程的 stdio 句柄(node 已把 stdin/stdout/stderr 重定向到文件)
  BOOL ok = CreateProcessW(NULL, cmd, NULL, NULL, TRUE,
                           CREATE_SUSPENDED | CREATE_NO_WINDOW,
                           NULL, NULL, &si, &pi);
  free(cmd);
  if (!ok) { CloseHandle(job); return 5; }

  if (!AssignProcessToJobObject(job, pi.hProcess)) {
    TerminateProcess(pi.hProcess, 1);
    CloseHandle(pi.hThread); CloseHandle(pi.hProcess); CloseHandle(job);
    return 6;
  }
  ResumeThread(pi.hThread);

  // 轮询等待:每 15ms 采样一次子进程提交内存(PrivateUsage),超过上限即强杀(MLE);
  // 同时累计等待时间,超过超时也强杀(TLE)。
  const DWORD POLL_MS = 15;
  const DWORD KILL_WAIT_MS = 800;
  DWORD elapsed = 0;
  int timedOut = 0;
  int memExceeded = 0;
  DWORD exitCode = 1;

  for (;;) {
    DWORD wait = WaitForSingleObject(pi.hProcess, POLL_MS);
    if (wait == WAIT_OBJECT_0) {
      GetExitCodeProcess(pi.hProcess, &exitCode);
      break;
    }
    elapsed += POLL_MS;
    PROCESS_MEMORY_COUNTERS pmc;
    if (GetProcessMemoryInfo(pi.hProcess, &pmc, sizeof(pmc))) {
      if (pmc.PagefileUsage > limitBytes) {   // 当前提交内存(旧头文件无 PrivateUsage,用 PagefileUsage,二者等价)
        memExceeded = 1;
        TerminateProcess(pi.hProcess, 1);
        WaitForSingleObject(pi.hProcess, KILL_WAIT_MS);
        break;
      }
    }
    if (elapsed >= timeoutMs) {
      timedOut = 1;
      TerminateProcess(pi.hProcess, 1);
      WaitForSingleObject(pi.hProcess, KILL_WAIT_MS);
      break;
    }
  }

  // 峰值内存:用 PSAPI 读进程的峰值提交内存(PeakPagefileUsage)。
  // 进程已退出但句柄仍有效,此时读取依然可用。
  PROCESS_MEMORY_COUNTERS pmc;
  SIZE_T peakBytes = 0;
  if (GetProcessMemoryInfo(pi.hProcess, &pmc, sizeof(pmc))) {
    peakBytes = pmc.PeakPagefileUsage;
  }

  FILE *f = _wfopen(reportFile, L"w");
  if (f) {
    fprintf(f, "peak_kb=%I64u exit_code=%lu timed_out=%d mem_exceeded=%d\n",
            (unsigned long long)(peakBytes / 1024),
            (unsigned long)exitCode, timedOut ? 1 : 0, memExceeded ? 1 : 0);
    fclose(f);
  }

  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  CloseHandle(job);
  return 0;
}
