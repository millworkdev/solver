import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { isIP } from 'node:net';
import { containsProviderCredentialMaterial } from './providerMetadataPolicy.js';
import { incumbentCandidateFindings, INCUMBENT_CANDIDATE_SOURCE_KINDS } from './providerIncumbentCandidates.js';
export const PROVIDER_CANDIDATE_PROTOCOLS = ['openai_chat', 'openai_responses', 'anthropic_messages', 'gemini_generate_content', 'bedrock_converse'];
export const PROVIDER_FEED_VERSION = 'provider-feed/v1';
export const PROVIDER_VALIDATOR_VERSION = 'provider-t0/v1';
const boundedString = { type: 'string', minLength: 1, maxLength: 256 };
const identifier = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const stringSet = (values) => ({ type: 'array', items: { type: 'string', enum: values }, uniqueItems: true, minItems: 1, maxItems: 8 });
export const PROVIDER_PROFILE_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['legal_entity', 'brand', 'domain', 'source_id', 'source_kind', 'support_url', 'privacy_url'],
    properties: { legal_entity: boundedString, brand: boundedString,
        domain: { type: 'string', pattern: '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$' },
        source_id: identifier, source_kind: { enum: ['publisher_direct', 'gateway', 'cloud'] },
        support_url: boundedString, privacy_url: boundedString },
};
const routeSchema = {
    type: 'object', additionalProperties: false,
    required: ['route_id', 'model_key', 'model_id', 'origin', 'path', 'protocol', 'region', 'data_classes',
        'capabilities', 'upstream_ref', 'fallback', 'price', 'lifecycle', 'valid_until', 'ownership_ref'],
    properties: { route_id: identifier, model_key: identifier, model_id: identifier,
        origin: boundedString, path: { type: 'string', pattern: '^/[a-zA-Z0-9/_-]{1,200}$' },
        protocol: { enum: ['openai_chat'] }, region: identifier,
        data_classes: stringSet(['public', 'internal', 'confidential']),
        capabilities: stringSet(['text_nonstream']), upstream_ref: { anyOf: [identifier, { type: 'null' }] },
        fallback: { const: false }, lifecycle: { enum: ['preview', 'active', 'deprecated', 'retired'] },
        valid_until: boundedString, ownership_ref: identifier, is_ready: { type: 'boolean' },
        price: { type: 'object', additionalProperties: false,
            required: ['currency', 'unit', 'input', 'output', 'revision_sha256'],
            properties: { currency: { const: 'USD' }, unit: { const: 'million_tokens' },
                input: { type: 'number', minimum: 0, maximum: 10000 },
                output: { type: 'number', minimum: 0, maximum: 10000 }, revision_sha256: digest } },
    },
};
export const PROVIDER_FEED_SCHEMA = {
    type: 'object', additionalProperties: false,
    required: ['schema_version', 'provider_source_id', 'generated_at', 'routes'],
    properties: { schema_version: { const: PROVIDER_FEED_VERSION }, provider_source_id: identifier,
        generated_at: boundedString, routes: { type: 'array', minItems: 1, maxItems: 100, items: routeSchema } },
};
const validator = new Ajv({ allErrors: true, removeAdditional: false, coerceTypes: false });
const validateFeedShape = validator.compile(PROVIDER_FEED_SCHEMA);
// The exported v1 contract stays unchanged for new providers. Only a declared
// incumbent receives this candidate-only schema; its exact identity policy follows.
export const PROVIDER_INCUMBENT_FEED_SCHEMA = {
    ...PROVIDER_FEED_SCHEMA,
    properties: { ...PROVIDER_FEED_SCHEMA.properties, routes: {
            ...PROVIDER_FEED_SCHEMA.properties.routes, items: { ...routeSchema, properties: {
                    ...routeSchema.properties, protocol: { enum: PROVIDER_CANDIDATE_PROTOCOLS },
                    upstream_ref: { anyOf: [identifier, { type: 'string',
                                pattern: '^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}@[a-z0-9][a-z0-9-]{0,63}$' }, { type: 'null' }] },
                } },
        } },
};
const validateIncumbentFeedShape = validator.compile(PROVIDER_INCUMBENT_FEED_SCHEMA);
const validateProfileShape = validator.compile(PROVIDER_PROFILE_SCHEMA);
/** Canonical subject bytes pin approval to all fields, including advisory price. */
export function providerDigest(value) {
    const canonical = (item) => Array.isArray(item) ? item.map(canonical)
        : item !== null && typeof item === 'object'
            ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([key, child]) => [key, canonical(child)]))
            : item;
    return createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'null').digest('hex');
}
export function safeProviderOrigin(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && url.origin === value && !url.username && !url.password
            && !url.port && !isIP(url.hostname) && !url.hostname.includes(':') && url.hostname.includes('.');
    }
    catch {
        return false;
    }
}
export function validateProviderProfile(value) {
    if (containsProviderCredentialMaterial(value) || !validateProfileShape(value))
        return false;
    return [value.support_url, value.privacy_url].every(link => {
        try {
            const url = new URL(link);
            return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search;
        }
        catch {
            return false;
        }
    });
}
export function validateProviderFeed(value, context) {
    const findings = [];
    let errorCount = 0;
    const add = (code, pointer, message) => {
        errorCount += 1;
        if (findings.length < 100)
            findings.push({ code, pointer, message, severity: 'error' });
    };
    const report = () => ({ schema_version: PROVIDER_FEED_VERSION,
        validator_version: PROVIDER_VALIDATOR_VERSION, input_sha256: providerDigest(value),
        result: findings.length ? 'nonconformant' : 'validated', findings,
        counts: { error: errorCount, warning: 0 } });
    if (Buffer.byteLength(JSON.stringify(value) ?? 'null') > 262144) {
        add('feed_size', '', 'Feed exceeds the offline input limit.');
        return report();
    }
    if (containsProviderCredentialMaterial(value)) {
        add('credential_material', '/', 'Credential material is refused in provider claims.');
        return report();
    }
    const canonicalKind = Object.hasOwn(INCUMBENT_CANDIDATE_SOURCE_KINDS, context.profile.source_id)
        ? INCUMBENT_CANDIDATE_SOURCE_KINDS[context.profile.source_id] : undefined;
    const declaredIncumbent = canonicalKind !== undefined && context.incumbentSources?.some(source => source.source_id === context.profile.source_id && source.source_kind === canonicalKind);
    const validateShape = declaredIncumbent ? validateIncumbentFeedShape : validateFeedShape;
    if (!validateShape(value)) {
        for (const issue of validateShape.errors ?? []) {
            const field = issue.keyword === 'required' ? issue.params.missingProperty : issue.keyword === 'additionalProperties' ? '[additional-property]' : undefined;
            const pointer = field === undefined ? issue.instancePath : `${issue.instancePath}/${String(field).replace(/~/g, '~0').replace(/\//g, '~1')}`;
            add(`schema_${issue.keyword}`, pointer, 'Field does not conform to the closed provider-feed/v1 schema.');
        }
        return report();
    }
    const now = (context.now ?? new Date()).getTime();
    const timestamp = (date) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(date)
        && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 19) === date.slice(0, 19);
    if (!timestamp(value.generated_at) || Date.parse(value.generated_at) > now + 300000)
        add('timestamp', '/generated_at', 'Use a valid UTC feed timestamp that is not in the future.');
    if (value.provider_source_id !== context.profile.source_id)
        add('ownership', '/provider_source_id', 'Source identity must match the provider profile.');
    const routeIds = new Set();
    value.routes.forEach((route, index) => {
        const pointer = `/routes/${index}`;
        if (routeIds.has(route.route_id))
            add('duplicate_route', `${pointer}/route_id`, 'Route ids must be unique.');
        routeIds.add(route.route_id);
        if (!safeProviderOrigin(route.origin) || new URL(route.origin).hostname !== context.profile.domain)
            add('origin', `${pointer}/origin`, 'Use the exact HTTPS origin on the proven provider domain, without port, credentials, query or path.');
        if (!context.modelKeys.includes(route.model_key))
            add('model_identity', `${pointer}/model_key`, 'Use a Millwork-issued model key.');
        const reserved = context.reservedModelPins?.find(pin => pin.model_key === route.model_key);
        // Closing a route does not change the issued model's immutable lifecycle.
        const closesRoute = route.lifecycle === 'deprecated' || route.lifecycle === 'retired';
        if (reserved && ((!closesRoute && route.lifecycle !== reserved.lifecycle) || JSON.stringify(route.capabilities) !== JSON.stringify(reserved.route_capabilities)))
            add('model_definition', pointer, 'Use the exact capabilities and lifecycle issued for this model key.');
        if (route.ownership_ref !== context.profile.source_id)
            add('ownership', `${pointer}/ownership_ref`, 'Ownership must bind to this provider source identity.');
        if (!timestamp(route.valid_until) || Date.parse(route.valid_until) <= now)
            add('expiry', `${pointer}/valid_until`, 'Route expiry must be a valid future UTC timestamp.');
        if (context.profile.source_kind === 'gateway' && !route.upstream_ref)
            add('upstream', `${pointer}/upstream_ref`, 'A gateway route requires a pinned upstream and fallback disabled.');
        if (context.profile.source_kind === 'publisher_direct' && /(?:^|[-_/])(?:latest|current)(?:$|[-_/])/i.test(route.model_id))
            add('alias', `${pointer}/model_id`, 'Publisher-direct routes require an exact release id.');
        if (context.profile.source_kind === 'cloud' && route.region === 'global')
            add('region', `${pointer}/region`, 'Cloud routes require a named region.');
        for (const finding of incumbentCandidateFindings(context.profile, route, context.incumbentSources, pointer)) {
            add(finding.code, finding.pointer, finding.message);
        }
    });
    return report();
}
const statementDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const statementIdentifier = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value);
const safe = (value, signed = false) => typeof value === 'number' && Number.isSafeInteger(value) && (signed || value >= 0);
const closed = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('|') === keys.slice().sort().join('|');
const totalKeys = ['input_tokens', 'output_tokens', 'amount_microusd', 'tax_microusd', 'adjustment_microusd'];
const lineKeys = ['line_id', 'request_id', 'source_request_id', 'tariff_id', 'tariff_revision', 'tariff_sha256', ...totalKeys, 'supplier_outcome'];
const period = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
/** Canonical UTF-8 JSON prevents ambiguous duplicate object keys. Digests identify bytes, not signatures. */
export function parseSupplierStatement(document, supplierTenantId) {
    const errors = [];
    let parsed;
    if (!document || typeof document.raw_document !== 'string' || !closed(document, document.filename === undefined ? ['raw_document', 'media_type'] : ['raw_document', 'media_type', 'filename'])
        || document.media_type !== 'application/json' || (document.filename !== undefined && !statementIdentifier(document.filename)))
        errors.push('document_metadata_invalid');
    if (typeof document?.raw_document !== 'string' || Buffer.byteLength(document.raw_document) > 65536)
        errors.push('document_size_invalid');
    if (errors.length)
        return { errors, parsed, raw_sha256: statementDigest(typeof document?.raw_document === 'string' ? document.raw_document : ''), parsed_sha256: null };
    let value;
    try {
        value = JSON.parse(document.raw_document);
    }
    catch {
        errors.push('document_json_invalid');
    }
    if (value !== undefined && JSON.stringify(value) !== document.raw_document)
        errors.push('document_noncanonical');
    if (!closed(value, ['version', 'supplier_tenant_id', 'statement_id', 'currency', 'period_start', 'period_end', 'declared_line_count', 'totals', 'lines']))
        errors.push('document_schema_invalid');
    else {
        if (value.version !== 'millwork.supplier-statement.v1')
            errors.push('version_unsupported');
        if (!statementIdentifier(value.statement_id) || !statementIdentifier(value.supplier_tenant_id))
            errors.push('document_identity_invalid');
        if (value.supplier_tenant_id !== supplierTenantId)
            errors.push('supplier_ownership_mismatch');
        if (value.currency !== 'USD')
            errors.push('currency_unsupported');
        if (!period(value.period_start) || !period(value.period_end) || value.period_start >= value.period_end)
            errors.push('statement_period_invalid');
        if (!Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 100)
            errors.push('line_count_invalid');
        else {
            if (!safe(value.declared_line_count) || value.declared_line_count !== value.lines.length)
                errors.push('declared_line_count_mismatch');
            const identities = new Set();
            const requests = new Set();
            for (const line of value.lines) {
                if (!closed(line, lineKeys)) {
                    errors.push('line_schema_invalid');
                    continue;
                }
                if (!['line_id', 'request_id', 'source_request_id', 'tariff_id', 'tariff_revision'].every(key => statementIdentifier(line[key]))
                    || !(/^[a-f0-9]{64}$/).test(line.tariff_sha256) || !['succeeded', 'failed'].includes(line.supplier_outcome))
                    errors.push('line_identity_invalid');
                if (identities.has(line.line_id) || requests.has(line.request_id))
                    errors.push('line_identity_duplicate');
                identities.add(line.line_id);
                requests.add(line.request_id);
                if (!totalKeys.every(key => safe(line[key], key === 'adjustment_microusd')))
                    errors.push('line_integer_invalid');
            }
            if (!closed(value.totals, totalKeys) || !totalKeys.every(key => safe(value.totals[key], key === 'adjustment_microusd')))
                errors.push('control_totals_invalid');
            else if (!errors.includes('line_integer_invalid') && !errors.includes('line_schema_invalid')) {
                for (const key of totalKeys) {
                    const sum = value.lines.reduce((total, line) => total + BigInt(line[key]), 0n);
                    if (sum !== BigInt(value.totals[key]))
                        errors.push('control_totals_mismatch');
                }
            }
        }
        if (!errors.length)
            parsed = value;
    }
    return { errors: [...new Set(errors)].sort(), parsed, raw_sha256: statementDigest(document.raw_document), parsed_sha256: value === undefined ? null : statementDigest(JSON.stringify(value)) };
}
export function reconcileSupplierStatementLine(facts, line, periodStart, periodEnd) {
    if (!facts.outcome)
        return 'supplier_outcome_missing';
    const completedAt = new Date(facts.outcome.completed_at).toISOString();
    if (completedAt < periodStart || completedAt >= periodEnd)
        return 'request_outside_period';
    if (facts.source_request_id !== line.source_request_id)
        return 'source_request_mismatch';
    if (facts.tariff.id !== line.tariff_id || facts.tariff.revision !== line.tariff_revision || facts.tariff.sha256 !== line.tariff_sha256)
        return 'tariff_mismatch';
    if (facts.input_tokens !== line.input_tokens || facts.output_tokens !== line.output_tokens)
        return 'token_count_mismatch';
    if (facts.outcome.status !== line.supplier_outcome)
        return 'supplier_outcome_mismatch';
    if (BigInt(facts.outcome.actual_supplier_microusd) !== BigInt(line.amount_microusd))
        return 'supplier_amount_mismatch';
    if (facts.tax_microusd !== line.tax_microusd)
        return 'tax_mismatch';
    const adjustments = facts.effects.filter(effect => effect.dimension === 'supplier_payable' && effect.evidence.correction === true)
        .reduce((sum, effect) => sum + BigInt(effect.delta_microusd), 0n);
    if (adjustments !== BigInt(line.adjustment_microusd))
        return 'adjustment_mismatch';
    return 'exact_match';
}
export function buildSupplierStatement(statement) {
    const document = { raw_document: JSON.stringify(statement), media_type: 'application/json' };
    const result = parseSupplierStatement(document, statement.supplier_tenant_id);
    if (result.errors.length)
        throw new Error('Statement is invalid: ' + result.errors.join(', '));
    return document;
}
export function checkSupplierStatement(document, supplierTenantId, facts = {}) {
    const validation = parseSupplierStatement(document, supplierTenantId);
    const lines = validation.parsed?.lines.map(line => ({ line_id: line.line_id,
        reason_code: facts[line.request_id] ? reconcileSupplierStatementLine(facts[line.request_id], line, validation.parsed.period_start, validation.parsed.period_end) : 'not_checked' })) ?? [];
    return { result: validation.errors.length || lines.some(line => !['not_checked', 'exact_match'].includes(line.reason_code)) ? 'nonconformant' : 'validated',
        errors: validation.errors, raw_sha256: validation.raw_sha256, parsed_sha256: validation.parsed_sha256, lines,
        authority: 'offline_check_only' };
}
