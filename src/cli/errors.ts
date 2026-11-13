/** An expected error whose message is meant for the user: printed without a stack trace. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}
