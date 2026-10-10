/**
 * 应用统一错误（docs/03-详细设计 §8 错误码约定）。
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'AppError'
  }
}
