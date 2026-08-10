// HTML pattern values compile with the Unicode Sets (`v`) flag, where `-` must be escaped.
export const ADMIN_USERNAME_INPUT_PATTERN = "[A-Za-z0-9][A-Za-z0-9._\\-]*";

const ADMIN_PASSWORD_MINIMUM_CODE_POINTS = 8;
const ADMIN_PASSWORD_MAXIMUM_CODE_POINTS = 128;

export function isAdminPasswordLengthValid(password: string): boolean {
  const length = Array.from(password).length;
  return (
    length >= ADMIN_PASSWORD_MINIMUM_CODE_POINTS && length <= ADMIN_PASSWORD_MAXIMUM_CODE_POINTS
  );
}

export const ADMIN_PASSWORD_LENGTH_MESSAGE = "密码长度须为 8 至 128 个 Unicode 字符。";
