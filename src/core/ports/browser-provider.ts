export type BrowserSession = {
  id: string;
  url: string;
};

export type BrowserAction =
  | {
      type: "navigate";
      url: string;
    }
  | {
      type: "click";
      selector: string;
    }
  | {
      type: "type";
      selector: string;
      text: string;
    }
  | {
      type: "scroll";
      amount: number;
    }
  | {
      type: "screenshot";
    };

export type BrowserResult = {
  success: boolean;
  screenshotUri?: string;
  pageTitle?: string;
  url?: string;
  text?: string;
  metadata?: Record<string, unknown>;
};

export interface BrowserProvider {
  createSession(url: string): Promise<BrowserSession>;

  execute(
    session: BrowserSession,
    action: BrowserAction,
  ): Promise<BrowserResult>;

  closeSession(session: BrowserSession): Promise<void>;
}