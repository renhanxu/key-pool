/**
 * 统一错误类型与错误处理工具
 */

/**
 * 业务异常
 */
export class BusinessError extends Error {
  public readonly statusCode: number;
  public readonly errorType: string;
  public readonly requestId?: string;
  
  constructor(
    message: string,
    statusCode = 400,
    errorType = "invalid_request_error",
    requestId?: string
  ) {
    super(message);
    this.name = "BusinessError";
    this.statusCode = statusCode;
    this.errorType = errorType;
    this.requestId = requestId;
  }
}

export class AuthError extends BusinessError {
  constructor(message = "Unauthorized", requestId?: string) {
    super(message, 401, "authentication_error", requestId);
  }
}

export class ForbiddenError extends BusinessError {
  constructor(message = "Forbidden", requestId?: string) {
    super(message, 403, "permission_error", requestId);
  }
}

export class NotFoundError extends BusinessError {
  constructor(message = "Not Found", requestId?: string) {
    super(message, 404, "not_found_error", requestId);
  }
}

export class ConflictError extends BusinessError {
  constructor(message = "Conflict", requestId?: string) {
    super(message, 409, "conflict_error", requestId);
  }
}

export class UpstreamError extends BusinessError {
  constructor(message = "Upstream error", requestId?: string) {
    super(message, 502, "upstream_error", requestId);
  }
}

/**
 * 统一成功响应包装
 */
export function ok<T>(data: T, requestId?: string) {
  return {
    success: true,
    data,
    request_id: requestId,
  };
}

/**
 * 统一分页响应
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
  requestId?: string
) {
  return {
    success: true,
    data: {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    } as PaginatedResponse<T>,
    request_id: requestId,
  };
}
