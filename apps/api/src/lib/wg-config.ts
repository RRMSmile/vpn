export function renderClientConfig(params: {
  template: string;
  clientPrivateKey?: string; // опционально
}) {
  const key = params.clientPrivateKey?.trim();
  if (!key) return params.template;

  return params.template.replace("{{CLIENT_PRIVATE_KEY}}", key);
}
