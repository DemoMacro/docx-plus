export {
  RELATIONSHIP_TYPES,
  Relationships,
  TargetModeType,
  buildRootRelationships,
  optionalRelsPart,
  partPathToRelsPath,
  resolveRelationshipTarget,
} from "./relationships";
export type { RelationshipType } from "./relationships";
export { Media, type BaseMediaEntry } from "./media";
export { EmbeddingCollection, type EmbeddingData } from "./embeddings";

// Core properties (OPC metadata)
export {
  parseCorePropsElement,
  buildCorePropertiesXmlString,
  type CorePropertiesOptions,
} from "./core";

// Extended (app) + custom properties (shared OPC parts)
export {
  appPropertiesDesc,
  type AppPropertiesOptions,
  type AppPropertiesInput,
  type HeadingPairOptions,
} from "./app-properties";
export {
  customPropertiesDesc,
  type CustomPropertyOptions,
  type CustomPropertiesInput,
} from "./custom-properties";

// Variant value types (vt:*) shared by the docProps parts
export {
  parseVariantValue,
  stringifyVariantValue,
  stringifyStringVector,
  parseVector,
  type VariantValue,
} from "./variant-types";

// Output types
export { convertOutput, OoxmlMimeType, type OutputByType, type OutputType } from "./output";

// Encrypted OOXML container passthrough
export {
  assertEncryptedExclusive,
  encryptedContainerOutput,
  encryptedContainerStream,
  isEncryptedContainer,
  type EncryptedContainerOptions,
} from "./encryption";

// ZIP packer
export {
  createPacker,
  createZipStream,
  ZipStreamWriter,
  zipAndConvert,
  zipSyncAndConvert,
  ZIP_DEFLATE_LEVEL,
  ZIP_STORED_LEVEL,
  levelForMediaName,
  type CompileFn,
  type CompressionOptions,
  type Packer,
  type PackerOptions,
  type XmlifyedFile,
  type ZipPartSink,
} from "./packer";
export type { Zippable, ZipOptions } from "./packer";
export { strFromU8, unzipSync, zipSync } from "./packer";
export { decodeBase64, encodeBase64 } from "../util/base64";

// Archive parser
export { parseArchive, ParsedArchive } from "./parser";
export { OOXML_CANONICAL_PREFIXES } from "./namespaces";

// OPC consistency validation
export {
  validateOpcConsistency,
  summarizeOpcIssues,
  type OpcIssue,
  type OpcCode,
  type OpcSeverity,
} from "./opc-consistency";
export {
  DOCX_PARTS,
  PPTX_PARTS,
  XLSX_PARTS,
  PART_REGISTRIES,
  type PartDefinition,
  type PartPresence,
  type PackagePartRegistry,
} from "./part-registry";
export { buildContentTypeOverrides, type ContentTypeOverrideEntry } from "./content-type-overrides";
export {
  contentTypesDesc,
  resolverFromRegistry,
  deriveContentTypes,
  type ContentTypeDefault,
  type ContentTypeOverride,
  type ContentTypesInput,
  type PartContentTypeResolver,
  type DeriveContentTypesOptions,
  IMAGE_MEDIA_CONTENT_TYPES,
} from "./content-types-input";

// Package-wide passthrough (SDK ExtendedPart analogue)
export {
  collectPassthroughParts,
  dropDanglingPassthroughRels,
  type PassthroughPart,
  type PassthroughRelationship,
  type PassthroughResult,
} from "./passthrough";
