export declare function runSupplierCli(args: string[]): Promise<void>;
/** Resolve the whole grammar before credentials, files or HTTP are touched. */
export declare function parseOfferCommand(args: string[]): {
    command: string;
    routeId?: string;
    supply?: {
        noun: string;
        id?: string;
    };
    flags: Map<string, string | true>;
};
export declare function runOfferCli(args: string[]): Promise<void>;
export declare function parseStatementCommand(args: string[]): {
    command: string;
    flags: Map<string, string | true>;
};
export declare function runStatementCli(args: string[]): Promise<void>;
