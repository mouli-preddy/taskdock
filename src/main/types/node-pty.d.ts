// Type declarations for @lydell/node-pty
// The package has types but exports configuration prevents resolution

declare module '@lydell/node-pty' {
  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: { [key: string]: string | undefined };
    encoding?: string | null;
    handleFlowControl?: boolean;
    flowControlPause?: string;
    flowControlResume?: string;
  }

  export interface IPty {
    pid: number;
    cols: number;
    rows: number;
    process: string;
    handleFlowControl: boolean;

    onData: (callback: (data: string) => void) => void;
    onExit: (callback: (exitInfo: { exitCode: number; signal?: number }) => void) => void;
    resize(cols: number, rows: number): void;
    write(data: string): void;
    kill(signal?: string): void;
    pause(): void;
    resume(): void;
  }

  export function spawn(
    file: string,
    args: string[],
    options: IPtyForkOptions
  ): IPty;
}
