export function byokChoice(offering) {
    return { source_id: offering.source_id, auth_scheme: offering.auth_scheme, served_variant_id: offering.served_variant_id };
}
/** Reuse the server's configured/certified choices; never invent a catalog or choose its first row. */
export async function planByokChoice(templates, input, choose) {
    if (input.servedVariantId && !input.sourceId)
        throw new Error("--served-variant-id requires --source-id.");
    const initial = await templates.plan({ template_id: "byok-open-model",
        ...(input.modelDeploymentId ? { model_deployment_id: input.modelDeploymentId } : {}) });
    const offerings = initial.byok_offerings ?? (initial.byok_source ? [initial.byok_source] : []);
    const matches = offerings.filter(item => (!input.sourceId || item.source_id === input.sourceId)
        && (!input.servedVariantId || item.served_variant_id === input.servedVariantId));
    if (input.modelDeploymentId) {
        if ((input.sourceId || input.servedVariantId) && (!initial.byok_source
            || !matches.some(item => item.source_id === initial.byok_source.source_id
                && item.served_variant_id === initial.byok_source.served_variant_id))) {
            throw new Error("The selected deployment does not match that provider/model. Your current model was not changed.");
        }
        return initial;
    }
    if (!matches.length && (input.sourceId || input.servedVariantId)) {
        throw new Error("That provider/model is not available for customer-owned setup. Run millwork provider list --json for available providers, or millwork tenant start --template byok-open-model --plan --json for offered model IDs. No connection was started.");
    }
    let selected = matches.length === 1 ? matches[0] : undefined;
    if (!selected && matches.length > 1 && choose)
        selected = await choose(matches);
    if (!selected)
        return choose && matches.length > 1 ? undefined : initial;
    if (initial.byok_source?.source_id === selected.source_id
        && initial.byok_source.auth_scheme === selected.auth_scheme
        && initial.byok_source.served_variant_id === selected.served_variant_id)
        return initial;
    return templates.plan({ template_id: "byok-open-model", byok_offering: byokChoice(selected) });
}
/** A saved application wins over current configuration, but never over an explicit conflicting choice. */
export function assertRecoveredByokChoice(application, filter) {
    if (!filter.sourceId && !filter.servedVariantId)
        return;
    const source = application.diagnostics.source_id;
    const variant = application.diagnostics.served_variant_id;
    if (application.template_id !== "byok-open-model" || (filter.sourceId && source !== filter.sourceId)
        || (filter.servedVariantId && variant !== filter.servedVariantId)) {
        throw new Error("This saved setup belongs to a different provider/model, or its old response cannot confirm that choice. Inspect it by --application-id, or start a distinct setup with --idempotency-key. Nothing was switched.");
    }
}
