// This is a deterministic refusal policy for recognizable credential material,
// not a promise to infer every possible opaque secret from arbitrary text.
const credentialText = /(?:(?<![a-z0-9])sk[-_][a-z0-9_-]+|(?<![a-z0-9])(?:ghp_|github_pat_|xox[baprs]-)[a-z0-9_-]+|Bearer\s+\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?<![a-z0-9])eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/i;
const credentialField = /^(?:api_key|raw_key|password|secret|client_secret|access_token|refresh_token|authorization)$/i;
export function containsProviderCredentialMaterial(value) {
    if (typeof value === 'string')
        return credentialText.test(value);
    if (Array.isArray(value))
        return value.some(containsProviderCredentialMaterial);
    if (value && typeof value === 'object')
        return Object.entries(value).some(([key, child]) => credentialText.test(key) || credentialField.test(key) || containsProviderCredentialMaterial(child));
    return false;
}
