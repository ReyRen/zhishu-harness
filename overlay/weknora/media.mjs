/** Authenticated knowledge images and transient image queries. */
export const KNOWLEDGE_IMAGE_ROUTE = '/api/zhishu-knowledge/image'
// WebNora's decoded query-image limit.
export const QUERY_IMAGE_BYTES = 8 * 1024 * 1024
const inlineImageTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const baseIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const resourcePattern = /^resource:\/\/[A-Za-z0-9_-]{22}$/u

/** Resolve only catalog resource handles in an explicit knowledge base. */
export function validImageReference(baseId, resource) {
  return typeof baseId === 'string' && baseIdPattern.test(baseId)
    && typeof resource === 'string' && resourcePattern.test(resource)
}

function imageURL(baseId, resource) {
  if (!validImageReference(baseId, resource)) return undefined
  return `.${KNOWLEDGE_IMAGE_ROUTE}?${new URLSearchParams({ kb: baseId, ref: resource })}`
}

/** Rewrite Markdown resource images while retaining their authored captions. */
export function rewriteKnowledgeImages(text, baseId) {
  return text.replace(/(!\[[^\]\r\n]*\]\(<?)(resource:\/\/[A-Za-z0-9_-]{22})(?=>?\s|>?\))/gu,
    (whole, prefix, resource) => {
      const url = imageURL(baseId, resource)
      return url ? prefix + url : whole
    })
}

/** Extract bounded image references and captions from scoped search response rows. */
export function passageImages(hits, possibleBases, limit, captionLimit) {
  const images = new Map()
  for (const hit of hits) {
    if (!possibleBases.includes(hit.knowledge_base_id)) continue
    let metadata
    try { metadata = typeof hit.image_info === 'string' ? JSON.parse(hit.image_info) : undefined }
    catch { /* A legacy malformed image list does not discard usable passage text. */ }
    const structured = Array.isArray(metadata) ? metadata : []
    const matches = Array.isArray(hit.matched_images) ? hit.matched_images : []
    for (const ref of [...matches, ...structured]) {
      const url = imageURL(hit.knowledge_base_id, ref?.url)
      if (!url || images.has(url) || (ref.knowledge_base_id && ref.knowledge_base_id !== hit.knowledge_base_id)) continue
      const caption = ref.caption ?? structured.find(row => row?.url === ref.url)?.caption
      images.set(url, { url, caption: typeof caption === 'string' ? caption.slice(0, captionLimit) : '' })
      if (images.size === limit) return [...images.values()]
    }
  }
  return [...images.values()]
}

/** Read a normalized attachment through the existing attachment provider. */
export async function readQueryImage(attachments, attachment, signal) {
  if (!attachments) return undefined
  const image = await attachments.readImageRequest(attachment, {
    width: attachment.width, height: attachment.height,
    maxImageBytes: QUERY_IMAGE_BYTES, imageTargetBytes: QUERY_IMAGE_BYTES,
  }, signal)
  if (!inlineImageTypes.has(image.mediaType) || !image.data.length || image.data.length > QUERY_IMAGE_BYTES) return undefined
  return Buffer.from(image.data).toString('base64')
}

/** Serve only an image that WebNora allows the current caller to read now. */
export function knowledgeImageHandler(transport, allowedIds, request = fetch) {
  const respond = (status, body = null, mime) => new Response(body, { status, headers: {
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    ...(mime && { 'content-type': mime }),
  } })
  return async incoming => {
    const params = new URL(incoming.url).searchParams
    const id = params.get('kb'), ref = params.get('ref')
    const load = params.get('load')
    if (params.size !== (load === null ? 2 : 3) || (load !== null && !/^\d{1,16}$/u.test(load))
      || !validImageReference(id, ref)) return respond(400)
    if (allowedIds.length && !allowedIds.includes(id)) return respond(403)
    const path = `/knowledge-bases/${id}/files?${new URLSearchParams({ file_path: ref })}`
    let upstream
    try {
      upstream = await request(transport.baseUrl + path, { redirect: 'manual',
        headers: { 'X-API-Key': transport.apiKey,
          ...(transport.tenantId && { 'X-Tenant-ID': String(transport.tenantId) }) },
        signal: AbortSignal.any([incoming.signal, AbortSignal.timeout(transport.requestTimeoutMs)]) })
    } catch (error) {
      incoming.signal.throwIfAborted()
      return respond(502)
    }
    const mime = upstream.headers.get('content-type')?.split(';')[0]?.toLowerCase()
    if (upstream.status === 200 && inlineImageTypes.has(mime)) return respond(200, upstream.body, mime)
    await upstream.body?.cancel()
    return respond([401, 403, 404].includes(upstream.status) ? upstream.status : upstream.status === 200 ? 415 : 502)
  }
}
