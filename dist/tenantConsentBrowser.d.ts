import { type ChildProcess, type SpawnOptions } from "node:child_process";
import type { TenantTemplateApplication } from "./types.js";
type BrowserResult = "requested" | "unavailable" | "failed" | "timed_out";
type Launch = (command: string, args: string[], options: SpawnOptions) => ChildProcess;
interface BrowserRuntime {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    launch?: Launch;
    timeoutMs?: number;
}
/** Request the OS browser, not consent itself. Never execute a shell or log its errors. */
export declare function openConsentBrowser(url: string, runtime?: BrowserRuntime): Promise<BrowserResult>;
interface ConsentPresenterOptions {
    interactive: boolean;
    noBrowser: boolean;
    write: (message: string) => void;
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    openBrowser?: (url: string) => Promise<BrowserResult>;
}
/** Presentation only: the existing application/resume API owns all progress. */
export declare function createConsentPresenter(options: ConsentPresenterOptions): {
    presentConsent(application: TenantTemplateApplication, suppliedUrl: string): Promise<void>;
    progress(application: TenantTemplateApplication): void;
};
export {};
