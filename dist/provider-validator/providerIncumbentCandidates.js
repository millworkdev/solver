export const INCUMBENT_CANDIDATE_SOURCE_KINDS = {
    openrouter: 'gateway', fireworks: 'cloud', aws_bedrock: 'cloud',
    anthropic_direct: 'publisher_direct', openai_direct: 'publisher_direct',
    gemini_developer_api: 'publisher_direct', deepseek_direct: 'publisher_direct',
    moonshot_direct: 'publisher_direct', xai_direct: 'publisher_direct',
};
const mutableAlias = /(?:^|[-_/:])(?:latest|current|default|stable)(?:$|[-_/:])/i;
const gatewayPair = /^([a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127})@([a-z0-9][a-z0-9-]{0,63})$/;
/** T0 policy only: feeds cannot redefine the identity or overwrite the static serving set. */
export function incumbentCandidateFindings(profile, claim, sources, pointer) {
    const findings = [];
    const add = (code, field, message) => findings.push({
        code, pointer: `${pointer}/${field}`, severity: 'error', message,
    });
    if (sources?.some(source => source.static_route_ids.includes(claim.route_id))) {
        add('static_id_collision', 'route_id', 'A static served-variant or deployment id cannot be replaced by a candidate. Use a new candidate route id.');
    }
    const canonicalKind = Object.hasOwn(INCUMBENT_CANDIDATE_SOURCE_KINDS, profile.source_id)
        ? INCUMBENT_CANDIDATE_SOURCE_KINDS[profile.source_id] : undefined;
    if (canonicalKind === undefined)
        return findings;
    const facts = sources?.find(source => source.source_id === profile.source_id);
    if (!facts || facts.source_kind !== canonicalKind) {
        add('incumbent_context', 'ownership_ref', 'Current server-issued incumbent validation context is required. Refresh it and retry.');
        return findings;
    }
    if (profile.source_kind !== canonicalKind) {
        add('source_kind', 'ownership_ref', 'An incumbent source keeps its server-owned source kind. Correct the provider profile.');
    }
    if (!facts.protocol_profiles.includes(claim.protocol)) {
        add('source_protocol', 'protocol', 'Use a protocol declared by this incumbent source.');
    }
    if (facts.static_routes.some(route => route.model_id === claim.model_id
        && route.protocol === claim.protocol && route.region === claim.region)) {
        add('static_route_collision', 'model_id', 'The static serving entry wins this exact model, protocol and region. A renamed candidate id cannot overwrite it.');
    }
    if (canonicalKind === 'gateway') {
        const pair = gatewayPair.exec(claim.upstream_ref ?? '');
        if (!pair || pair[1] !== claim.model_id || mutableAlias.test(pair[1])
            || !facts.gateway_pairs.some(pin => pin.model_key === claim.model_key
                && pin.model_id === claim.model_id && pin.upstream_ref === claim.upstream_ref)) {
            add('upstream_pair', 'upstream_ref', 'Use the server-issued exact model@provider pair for this model key, with fallback disabled.');
        }
    }
    if (canonicalKind === 'cloud' && !facts.candidate_releases.some(release => release.model_key === claim.model_key && release.model_id === claim.model_id)) {
        add('model_identity', 'model_id', 'Use the server-issued exact cloud model id for this model key.');
    }
    if (canonicalKind === 'publisher_direct' && ((mutableAlias.test(claim.model_id) || /^(?:deepseek-chat|deepseek-reasoner)$/i.test(claim.model_id))
        || !facts.candidate_releases.some(release => release.model_key === claim.model_key && release.model_id === claim.model_id))) {
        add('exact_release', 'model_id', 'Use the server-issued exact publisher release id for this model key; an alias is not an exact release.');
    }
    return findings;
}
