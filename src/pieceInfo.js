'use strict';

// Loose, best-effort frontmatter reader for the wall label. Unlike
// validate/frontmatter.js's validateFrontmatter (which fails a program
// outright on a missing title/rationale or an unresolved lineage ref),
// this never throws and never reports failures - a program with broken
// or missing frontmatter still runs on the panel and still deserves a
// label, so it falls back to the filename rather than blanking the
// display or crashing the daemon.

const path = require('path');
const yaml = require('js-yaml');

const FRONTMATTER_RE = /\/\*@vfx([\s\S]*?)@vfx\*\//;

// source: full program text. filePath: used for the title fallback only.
function parsePieceInfo(source, filePath) {
  let frontmatter = null;
  try {
    const match = FRONTMATTER_RE.exec(source);
    if (match) frontmatter = yaml.load(match[1]);
  } catch {
    frontmatter = null;
  }
  if (!frontmatter || typeof frontmatter !== 'object') frontmatter = {};

  const fallbackTitle = path.basename(filePath);
  return {
    title: typeof frontmatter.title === 'string' && frontmatter.title.trim() ? frontmatter.title : fallbackTitle,
    rationale: typeof frontmatter.rationale === 'string' ? frontmatter.rationale : '',
    artist: typeof frontmatter.artist === 'string' ? frontmatter.artist : '',
    created: typeof frontmatter.created === 'string' ? frontmatter.created : '',
  };
}

module.exports = { parsePieceInfo };
