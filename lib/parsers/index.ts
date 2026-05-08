// Parser dispatcher: route ke parser yang sesuai berdasarkan parser_id.

import type { ParsedDocument, ParseOptions, ParserFn } from "./types";
import { parseBsiBsinet } from "./bsi-bsinet";
import { getParserSpec } from "@/lib/banks/registry";

const PARSERS: Record<string, ParserFn> = {
  BSI_BSINET_PDF: parseBsiBsinet,
  // Coming soon — akan diisi di Phase 2
  // BSI_BYOND_PDF: parseBsiByond,
  // BCA_KLIKBCA_HTML: parseBcaKlikbca,
  // BCA_ESTATEMENT_PDF: parseBcaEstatement,
  // MANDIRI_PDF: parseMandiri,
  // BNI_PDF: parseBni,
  // BRI_PDF: parseBri,
  // ...
};

export class ParserNotImplementedError extends Error {
  constructor(public parserId: string, public bankLabel: string) {
    super(`Parser untuk "${bankLabel}" belum tersedia.`);
    this.name = "ParserNotImplementedError";
  }
}

export class ParserUnknownError extends Error {
  constructor(public parserId: string) {
    super(`Parser ID "${parserId}" tidak dikenal.`);
    this.name = "ParserUnknownError";
  }
}

/**
 * Parse file dengan parser yang sesuai.
 * Throws ParserNotImplementedError kalau parser belum di-implement (status: coming_soon).
 * Throws ParserUnknownError kalau parser_id tidak di-registry sama sekali.
 */
export async function parsePdfByParserId(
  file: File,
  parserId: string,
  opts?: ParseOptions,
): Promise<ParsedDocument> {
  const spec = getParserSpec(parserId);
  if (!spec) {
    throw new ParserUnknownError(parserId);
  }

  const fn = PARSERS[parserId];
  if (!fn) {
    throw new ParserNotImplementedError(parserId, spec.label);
  }

  return await fn(file, opts);
}

export type { ParsedDocument, ParsedTxRow, ParseOptions } from "./types";
