export class ActivationExchangeGate {
  private state: "idle" | "running" | "completed" = "idle";

  async run(action: () => Promise<void>): Promise<"completed" | "skipped"> {
    if (this.state !== "idle") return "skipped";
    this.state = "running";
    try {
      await action();
      this.state = "completed";
      return "completed";
    } catch (error) {
      this.state = "idle";
      throw error;
    }
  }

  reset(): boolean {
    if (this.state === "running") return false;
    this.state = "idle";
    return true;
  }
}
