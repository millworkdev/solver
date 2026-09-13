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
/** Open an already-validated hosted provider-consent URL. */
export declare function openConsentBrowser(url: string, runtime?: BrowserRuntime): Promise<BrowserResult>;
/** Open only a tokenized page on the CLI-owned IPv4 loopback server. */
export declare function openOrganizationKeyBrowser(url: string, runtime?: BrowserRuntime): Promise<BrowserResult>;
interface ConsentPresenterOptions {
    interactive: boolean;
    noBrowser: boolean;
    explicitOpenBrowser?: boolean;
    write: (message: string) => void;
    environment?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    openBrowser?: (url: string) => Promise<BrowserResult>;
}
/** Shared browser presentation for a server-owned setup or rotation handoff. */
export declare function presentProviderConsent(input: {
    sourceId: unknown;
    authScheme?: unknown;
    url: string;
    expiresAt: string;
}, options: ConsentPresenterOptions): Promise<void>;
/** Presentation only: the existing application/resume API owns all progress. */
export declare function createConsentPresenter(options: ConsentPresenterOptions): {
    presentConsent(application: TenantTemplateApplication, suppliedUrl: string): Promise<void>;
    progress(application: TenantTemplateApplication): void;
};
export {};
