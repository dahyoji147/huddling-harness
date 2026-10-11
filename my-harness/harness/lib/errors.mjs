// 종료 코드: 0 통과, 1 실패 또는 대기, 2 오류, 3 차단
export class HarnessError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
