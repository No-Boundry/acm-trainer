@echo off
rem ACM-Trainer 一键安装依赖
cd /d "%~dp0"
echo 正在安装依赖（使用 npmmirror 镜像）...
call npm.cmd install
echo.
echo 依赖安装完成。运行 start-dev.bat 启动应用。
pause
