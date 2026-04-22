// Helpers for constructing docx block payloads.
//
// Right now (v1.3.4) only the image path is implemented — enough to cover the
// create_doc_block / update_doc_block image shortcuts. More block builders
// (heading / list / code / table) will land in v1.3.5 when the local-markdown
// → wiki-docx sync feature is built; parking the skeleton here now so the
// later additions don't introduce a new file.

// docx v1 block_type enum (relevant subset).
// Docs: https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document-block/create
const BLOCK_TYPE = {
  PAGE:        1,
  TEXT:        2,
  HEADING1:    3,
  HEADING2:    4,
  HEADING3:    5,
  HEADING4:    6,
  HEADING5:    7,
  HEADING6:    8,
  HEADING7:    9,
  HEADING8:   10,
  HEADING9:   11,
  BULLET:     12,
  ORDERED:    13,
  CODE:       14,
  QUOTE:      15,
  EQUATION:   16,
  TODO:       17,
  BITABLE:    18,
  CALLOUT:    19,
  CHAT_CARD:  20,
  DIAGRAM:    21,
  DIVIDER:    22,
  FILE:       23,
  GRID:       24,
  GRID_COL:   25,
  IFRAME:     26,
  IMAGE:      27,
  TABLE:      31,
};

/**
 * The image-block creation flow on Feishu docx v1 is three steps:
 *   1. POST .../blocks/<parent>/children with an empty image placeholder:
 *        { block_type: 27, image: {} }
 *      This returns a real block_id for the image slot.
 *   2. POST /open-apis/drive/v1/medias/upload_all with parent_type=docx_image
 *      and parent_node=<that block_id> to upload the pixels. Returns file_token.
 *   3. PATCH .../blocks/<block_id> with { replace_image: { token: file_token } }
 *      to populate the placeholder with the uploaded image.
 *
 * See official.js::createDocBlockWithImage which orchestrates all three steps.
 */

/** Empty image block used as the placeholder in step 1. */
function buildEmptyImageBlock() {
  return { block_type: BLOCK_TYPE.IMAGE, image: {} };
}

/** Patch body for step 3 — attaches an uploaded image_token to a placeholder block. */
function buildReplaceImagePayload(imageToken) {
  if (!imageToken) throw new Error('buildReplaceImagePayload: imageToken is required');
  return { replace_image: { token: imageToken } };
}

module.exports = {
  BLOCK_TYPE,
  buildEmptyImageBlock,
  buildReplaceImagePayload,
};
