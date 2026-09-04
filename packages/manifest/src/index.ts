export interface ManifestDraftMarker {
  readonly schemaStatus: 'unapproved'
  readonly reason: 'RFC_REQUIRED'
}

export const MANIFEST_DRAFT: ManifestDraftMarker = {
  schemaStatus: 'unapproved',
  reason: 'RFC_REQUIRED',
}
