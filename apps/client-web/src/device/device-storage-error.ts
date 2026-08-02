export class DeviceCredentialPersistenceError extends Error {
  readonly storageCause: unknown;

  constructor(storageCause: unknown) {
    super(
      "设备凭据已可能在服务端生效，但浏览器安全存储提交失败；恢复句柄已保留，请勿发起新的激活",
    );
    this.name = "DeviceCredentialPersistenceError";
    this.storageCause = storageCause;
  }
}
