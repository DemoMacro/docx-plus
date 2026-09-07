/**
 * Shared inline run/paragraph stringification for DOCX descriptors.
 *
 * Used by table.ts, comments.ts, body.ts, and other descriptors that need to
 * serialize paragraph/run content. Includes JSON child dispatch for all
 * ParagraphChild variants (picture, chart, hyperlink, etc.).
 *
 * Pure string concatenation — no intermediate object tree.
 *
 * @module
 */

import { RELATIONSHIP_TYPES, hpsMeasureValue } from "@office-open/core";
import { TargetModeType } from "@office-open/core";
import { escapeXml } from "@office-open/xml";
import { subDocDesc } from "@parts/bodychildren";
import { objectDesc, type ObjectElementOptions } from "@parts/object";
import type {
  BookmarkOptions,
  BookmarkStartOptions,
  MarkupRangeOptions,
  MoveRangeOptions,
  MoveRangeStartOptions,
} from "@parts/paragraph/links/bookmark";
import type {
  ComplexFieldOptions,
  ParagraphChild,
  ParagraphOptions,
  TrackChangeChild,
} from "@parts/paragraph/paragraph";
import type { CommentChildOptions } from "@parts/paragraph/run/comment-run";
import type { RubyOptions } from "@parts/paragraph/run/ruby";
import {
  breakXml,
  EMPTY_RUN_ELEMENTS,
  type BreakOptions,
  type RunOptions,
} from "@parts/paragraph/run/run";
import type { SymbolRunOptions } from "@parts/paragraph/run/symbol-run";
import { stringifyPict, type PictOptions } from "@parts/pict";
import { autoRevisionId } from "@shared/track-revision/track-revision";

import type { BodyContext } from "../context";
import { checkboxSymbolRunInner, stringifyCustomXmlShell, stringifySdtShell } from "./bodychildren";
import { stringifyDrawingChild } from "./inline-drawings";
import { stringifyMath, stringifyMathParagraph } from "./paragraph/math/stringify";
import { createBegin, createSeparate, createEnd } from "./paragraph/run/field";
import {
  onOff,
  paragraphIdentityAttrs,
  stringifyParagraphProperties,
  stringifyRunProperties,
} from "./paragraph/stringify";

// ── Run ──

function stringifySymbolRunInner(opts: SymbolRunOptions): string {
  const tag = opts.kind === "office2016" ? "w16se:sym" : "w:sym";
  return `<${tag} w:char="${escapeXml(opts.char)}" w:font="${escapeXml(opts.symbolFont ?? "Wingdings")}"/>`;
}

/** Serialize a complex field's run chain. Inside a w:del wrapper the
 *  instruction is spelled w:delInstrText and the cached result w:delText. */
function stringifyComplexFieldRuns(cf: ComplexFieldOptions, isDelete = false): string {
  const instrTag = isDelete ? "w:delInstrText" : "w:instrText";
  const textTag = isDelete ? "w:delText" : "w:t";
  // Run-properties: Word writes identical rPr across a field's runs. Apply
  // the captured control-run rPr to begin/instrText/separate/end and the
  // result-run rPr to the result (defaults to the control rPr when the
  // result had none, matching Word's uniform behavior).
  const ctrl = cf.rPrXml ?? "";
  const res = cf.resultRPrXml ?? ctrl;
  // Instruction: verbatim when the source split it across non-plain runs;
  // plain template otherwise; no instruction run at all for an empty
  // instruction (a bare begin→end field round-trips without one).
  const instrXml =
    cf.instrRunsXml ??
    (cf.instruction !== ""
      ? `<w:r>${ctrl}<${instrTag} xml:space="preserve">${escapeXml(cf.instruction)}</${instrTag}></w:r>`
      : "");
  // `separate` + the result run are emitted only when there is a cached
  // result; a result-less field round-trips as begin/instrText/end. Result
  // runs go verbatim when the source split them beyond the plain template.
  const resultXml =
    cf.resultRunsXml !== undefined
      ? `<w:r>${ctrl}<w:fldChar w:fldCharType="separate"/></w:r>` + cf.resultRunsXml
      : cf.result !== undefined
        ? `<w:r>${ctrl}<w:fldChar w:fldCharType="separate"/></w:r>` +
          `<w:r>${res}<${textTag} xml:space="preserve">${escapeXml(cf.result)}</${textTag}></w:r>`
        : "";
  const lrpb = cf.lastRenderedPageBreak ? "<w:lastRenderedPageBreak/>" : "";
  return (
    `<w:r>${ctrl}${lrpb}<w:fldChar w:fldCharType="begin"/></w:r>` +
    instrXml +
    resultXml +
    `<w:r>${cf.endRPrXml ?? ctrl}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

/** Serialize a deleted run: rPr + delText (or field delInstrText). */
function stringifyDeletedRun(c: RunOptions | string): string {
  const opts = typeof c === "string" ? { text: c } : c;
  const parts: string[] = [];
  // Reference runs keep exactly the run properties the source carried —
  // Word does not always style comment references, so nothing is injected.
  const rPr = stringifyRunProperties(opts);
  if (rPr) parts.push(rPr);
  if (opts.break) parts.push(breakXml(opts.break));
  let attr = "";
  if (opts.additionRsid) attr += ` w:rsidR="${opts.additionRsid}"`;
  if (opts.runPropertiesRsid) attr += ` w:rsidRPr="${opts.runPropertiesRsid}"`;
  if (opts.deletionRsid) attr += ` w:rsidDel="${opts.deletionRsid}"`;
  const openTag = attr ? `<w:r${attr}>` : "<w:r>";
  if (opts.children) {
    for (const cc of opts.children) {
      if (typeof cc === "string") {
        parts.push(`<w:delText xml:space="preserve">${escapeXml(cc)}</w:delText>`);
      } else if (typeof cc === "object" && cc !== null && "commentReference" in cc) {
        parts.push(`<w:commentReference w:id="${Number(cc.commentReference)}"/>`);
      } else if (typeof cc === "object" && cc !== null && "break" in cc) {
        parts.push(breakXml((cc as { break: number | BreakOptions }).break));
      }
    }
  } else if (opts.text) {
    parts.push(`<w:delText xml:space="preserve">${escapeXml(String(opts.text))}</w:delText>`);
  }
  return `${openTag}${parts.join("")}</w:r>`;
}

function stringifyRubyContent(opts: RubyOptions["text"], ctx: BodyContext): string {
  return (
    opts.children
      ?.map((child) => stringifyRunInline(typeof child === "string" ? { text: child } : child, ctx))
      .join("") ?? ""
  );
}

function stringifyRuby(opts: RubyOptions, ctx: BodyContext): string {
  const properties = opts.properties;
  const dirty = properties.dirty !== undefined ? onOff("w:dirty", properties.dirty) : "";
  return (
    `<w:ruby><w:rubyPr>` +
    `<w:rubyAlign w:val="${properties.alignment}"/>` +
    `<w:hps w:val="${hpsMeasureValue(properties.fontSize * 2)}"/>` +
    `<w:hpsRaise w:val="${hpsMeasureValue(properties.raise * 2)}"/>` +
    `<w:hpsBaseText w:val="${hpsMeasureValue(properties.baseFontSize * 2)}"/>` +
    `<w:lid w:val="${escapeXml(properties.languageId)}"/>` +
    `${dirty}</w:rubyPr>` +
    `<w:rt>${stringifyRubyContent(opts.text, ctx)}</w:rt>` +
    `<w:rubyBase>${stringifyRubyContent(opts.base, ctx)}</w:rubyBase>` +
    `</w:ruby>`
  );
}

export function stringifyRunInline(opts: RunOptions, ctx: BodyContext): string {
  let body = "";

  // Pre-scan children for commentReference — a styled reference carries the
  // CommentReference style in its own properties; only an unstyled fresh one
  // gets the conventional default. The scan is pointless when a style is
  // already set (the default can never apply).
  let commentRefStyle = false;
  if (opts.children && !opts.style) {
    for (const child of opts.children) {
      if (typeof child === "object" && child !== null && "commentReference" in child) {
        commentRefStyle = true;
        break;
      }
    }
  }

  const runOpts =
    commentRefStyle && !opts.style ? { ...opts, style: "CommentReference" as const } : opts;
  const rPr = stringifyRunProperties(runOpts);
  if (rPr) body += rPr;

  if (opts.break) body += breakXml(opts.break);

  // Top-level references — a pure reference run flattened by the parse path
  // (e.g. inside w:hyperlink) carries the reference alongside its rPr with no
  // children; without this branch the run would emit empty and drop it.
  const fnRef = opts.footnoteReference;
  const enRef = opts.endnoteReference;
  if (fnRef !== undefined) {
    const id = typeof fnRef === "number" ? fnRef : fnRef.id;
    const cmf =
      typeof fnRef === "object" && fnRef.customMarkFollows ? ' w:customMarkFollows="1"' : "";
    body += `<w:footnoteReference w:id="${id}"${cmf}/>`;
  } else if (enRef !== undefined) {
    const id = typeof enRef === "number" ? enRef : enRef.id;
    const cmf =
      typeof enRef === "object" && enRef.customMarkFollows ? ' w:customMarkFollows="1"' : "";
    body += `<w:endnoteReference w:id="${id}"${cmf}/>`;
  }

  if (opts.children) {
    for (const child of opts.children) {
      if (typeof child === "string") {
        body += `<w:t xml:space="preserve">${escapeXml(child)}</w:t>`;
      } else if (typeof child === "object" && child !== null) {
        // Bare run-inner elements — emit directly inside this <w:r>. Must run
        // before stringifyChildDispatch, which wraps paragraph-level children
        // in their own <w:r> (correct for paragraphs, nested/invalid in a run).
        if ("tab" in child) {
          body += "<w:tab/>";
          continue;
        }
        if ("pageBreak" in child) {
          body += '<w:br w:type="page"/>';
          continue;
        }
        if ("columnBreak" in child) {
          body += '<w:br w:type="column"/>';
          continue;
        }
        if ("break" in child) {
          body += breakXml((child as { break: number | BreakOptions }).break);
          continue;
        }
        if ("commentReference" in child) {
          body += `<w:commentReference w:id="${Number(child.commentReference)}"/>`;
          continue;
        }
        // Symbol run — emit bare; the dispatch branch wraps it in its own
        // <w:r>, which would nest illegally inside this run.
        if ("symbolRun" in child) {
          const sym = child.symbolRun;
          body += `${stringifyRunProperties(sym) ?? ""}${stringifySymbolRunInner(sym)}`;
          continue;
        }
        // Reference elements inside a run's children[] (mixed-content runs)
        // emit bare — the paragraph-level dispatch would wrap them in a
        // nested <w:r>, which is invalid inside a run.
        const bareFnRef = (child as RunOptions).footnoteReference;
        if (bareFnRef !== undefined) {
          const id = typeof bareFnRef === "number" ? bareFnRef : bareFnRef.id;
          const cmf =
            typeof bareFnRef === "object" && bareFnRef.customMarkFollows
              ? ' w:customMarkFollows="1"'
              : "";
          body += `<w:footnoteReference w:id="${id}"${cmf}/>`;
          continue;
        }
        const bareEnRef = (child as RunOptions).endnoteReference;
        if (bareEnRef !== undefined) {
          const id = typeof bareEnRef === "number" ? bareEnRef : bareEnRef.id;
          const cmf =
            typeof bareEnRef === "object" && bareEnRef.customMarkFollows
              ? ' w:customMarkFollows="1"'
              : "";
          body += `<w:endnoteReference w:id="${id}"${cmf}/>`;
          continue;
        }
        // Empty run elements — separator, noBreakHyphen, pgNum, etc.
        let firstKey: string | undefined;
        for (const key in child) {
          firstKey = key;
          break;
        }
        const emptyXml = firstKey !== undefined ? EMPTY_RUN_ELEMENTS[firstKey] : undefined;
        if (emptyXml) {
          body += emptyXml;
          continue;
        }
        if ("ruby" in child) {
          body += stringifyRuby((child as { ruby: RubyOptions }).ruby, ctx);
          continue;
        }
        // OLE object — w:object (VML shape + objectEmbed/link/control/movie)
        if ("object" in child) {
          // RunOptions.children carries Record<string, unknown>, so `in`
          // narrows to unknown — cast back to the object variant payload.
          body +=
            objectDesc.stringify((child as { object: ObjectElementOptions }).object, ctx) ?? "";
          continue;
        }
        // VML picture — w:pict emits bare inside this <w:r>
        if ("pict" in child) {
          body += stringifyPict((child as { pict: PictOptions }).pict, ctx);
          continue;
        }
        // JSON child dispatch (images, charts, hyperlinks, etc.)
        const jsonResult = stringifyChildDispatch(child as ParagraphChild, ctx);
        if (jsonResult !== undefined) {
          body += Array.isArray(jsonResult) ? jsonResult.join("") : jsonResult;
        } else if ("text" in child || "children" in child || "break" in child) {
          body += stringifyRunInline(child as RunOptions, ctx);
        }
        // Anything else is an unknown field — silent no-op (runtime convention
        // for unrecognized JSON: TS excess-property checks guard authoring,
        // unknown runtime fields pass through without emitting).
      }
    }
  } else if (opts.text !== undefined) {
    body += `<w:t xml:space="preserve">${escapeXml(String(opts.text))}</w:t>`;
  }

  let attr = "";
  if (opts.additionRsid) attr += ` w:rsidR="${opts.additionRsid}"`;
  if (opts.runPropertiesRsid) attr += ` w:rsidRPr="${opts.runPropertiesRsid}"`;
  if (opts.deletionRsid) attr += ` w:rsidDel="${opts.deletionRsid}"`;

  return body.length === 0 ? (attr ? `<w:r${attr}/>` : "<w:r/>") : `<w:r${attr}>${body}</w:r>`;
}

// ── JSON child dispatch ──

/**
 * Stringify a ParagraphChild into one or more XML strings.
 *
 * Handles side effects (media, chart, smartArt, relationship registration)
 * directly without creating temporary class instances.
 *
 * Returns `undefined` if the child is not a recognized JSON wrapper.
 */
/**
 * Build the rPr XML for a break/tab run from its structured run properties.
 */
/** Shared attribute string for CT_MarkupRange end markers (commentRange, move range end). */
export function buildMarkupRangeAttrs(m: MarkupRangeOptions): string {
  const a: string[] = [`w:id="${m.id}"`];
  if (m.displacedByCustomXml) a.push(`w:displacedByCustomXml="${m.displacedByCustomXml}"`);
  return a.join(" ");
}

/** Shared attribute string for w:bookmarkStart (CT_Bookmark). */
export function buildBookmarkStartAttrs(bs: BookmarkStartOptions): string {
  const a: string[] = [`w:id="${bs.id}"`, `w:name="${escapeXml(bs.name)}"`];
  if (bs.displacedByCustomXml) a.push(`w:displacedByCustomXml="${bs.displacedByCustomXml}"`);
  if (bs.colFirst !== undefined) a.push(`w:colFirst="${bs.colFirst}"`);
  if (bs.colLast !== undefined) a.push(`w:colLast="${bs.colLast}"`);
  return a.join(" ");
}

/** Shared attribute string for w:moveFromRangeStart / w:moveToRangeStart (CT_MoveBookmark). */
function buildMoveRangeStartAttrs(m: MoveRangeStartOptions): string {
  const a: string[] = [`w:id="${m.id}"`];
  if (m.name) a.push(`w:name="${escapeXml(m.name)}"`);
  if (m.author) a.push(`w:author="${escapeXml(m.author)}"`);
  if (m.date) a.push(`w:date="${m.date}"`);
  if (m.displacedByCustomXml) a.push(`w:displacedByCustomXml="${m.displacedByCustomXml}"`);
  if (m.colFirst !== undefined) a.push(`w:colFirst="${m.colFirst}"`);
  if (m.colLast !== undefined) a.push(`w:colLast="${m.colLast}"`);
  return a.join(" ");
}

/** Stringify inline run/text content — the `wrap` shared by every sugar child. */
function stringifyInlineWrap(wrap: (string | RunOptions)[] | undefined, ctx: BodyContext): string {
  const parts: string[] = [];
  for (const item of wrap ?? []) {
    parts.push(
      typeof item === "string"
        ? stringifyRunInline({ text: item }, ctx)
        : stringifyRunInline(item, ctx),
    );
  }
  return parts.join("");
}

/**
 * Serialize a break run inside a track-change wrapper. A parsed break run
 * keeps its run properties and rsid attributes — the same flat-props shape
 * the paragraph-level break variants carry.
 */
function stringifyTrackChangeBreak(opts: RunOptions, type: "page" | "column"): string {
  const rPr = stringifyRunProperties(opts) ?? "";
  let attr = "";
  if (opts.additionRsid) attr += ` w:rsidR="${opts.additionRsid}"`;
  if (opts.runPropertiesRsid) attr += ` w:rsidRPr="${opts.runPropertiesRsid}"`;
  if (opts.deletionRsid) attr += ` w:rsidDel="${opts.deletionRsid}"`;
  return `<w:r${attr}>${rPr}<w:br w:type="${type}"/></w:r>`;
}

/**
 * Serialize the children of a track-change wrapper: runs (delText inside
 * w:del, plain text inside w:ins), comment range markers, and nested
 * same-family wrappers — each child's text form follows its nearest wrapper.
 */
function stringifyTrackChangeChildren(
  children: readonly TrackChangeChild[],
  ctx: BodyContext,
  isDelete: boolean,
): string {
  const parts: string[] = [];
  for (const c of children) {
    if (typeof c !== "string" && "commentRangeStart" in c) {
      parts.push(`<w:commentRangeStart ${buildMarkupRangeAttrs(c.commentRangeStart)}/>`);
    } else if (typeof c !== "string" && "commentRangeEnd" in c) {
      parts.push(`<w:commentRangeEnd ${buildMarkupRangeAttrs(c.commentRangeEnd)}/>`);
    } else if (typeof c !== "string" && "insertion" in c) {
      const { id, author, date, children: nested } = c.insertion;
      parts.push(
        `<w:ins w:id="${id ?? autoRevisionId()}" w:author="${escapeXml(String(author))}" w:date="${date}">` +
          stringifyTrackChangeChildren(nested, ctx, false) +
          "</w:ins>",
      );
    } else if (typeof c !== "string" && "deletion" in c) {
      const { id, author, date, children: nested } = c.deletion;
      parts.push(
        `<w:del w:id="${id ?? autoRevisionId()}" w:author="${escapeXml(String(author))}" w:date="${date}">` +
          stringifyTrackChangeChildren(nested, ctx, true) +
          "</w:del>",
      );
    } else if (typeof c !== "string" && "pageBreak" in c) {
      parts.push(stringifyTrackChangeBreak(c as RunOptions, "page"));
    } else if (typeof c !== "string" && "columnBreak" in c) {
      parts.push(stringifyTrackChangeBreak(c as RunOptions, "column"));
    } else if (typeof c !== "string" && "proofErr" in c) {
      parts.push(`<w:proofErr w:type="${c.proofErr}"/>`);
    } else if (typeof c !== "string" && "complexField" in c) {
      parts.push(stringifyComplexFieldRuns(c.complexField, isDelete));
    } else if (typeof c !== "string" && "formField" in c) {
      const xml = stringifyChildDispatch(c as ParagraphChild, ctx);
      if (typeof xml === "string") parts.push(xml);
    } else if (typeof c !== "string") {
      // A deleted plain-text run must become w:delText here, before dispatch —
      // dispatch is blind to the track-change context and its text fast path
      // would emit a plain w:t run. Everything else keeps the old route:
      // dispatch builds the complete <w:r> for drawings and other variants,
      // and plain-run shapes it does not recognize take the wrapper-aware
      // fallback below.
      if (isDelete && isPlainTextRun(c as ParagraphChild)) {
        parts.push(stringifyDeletedRun(c as RunOptions));
      } else {
        const xml = stringifyChildDispatch(c as ParagraphChild, ctx);
        if (typeof xml === "string") {
          parts.push(xml);
        } else {
          parts.push(
            isDelete
              ? stringifyDeletedRun(c as RunOptions)
              : stringifyRunInline(c as RunOptions, ctx),
          );
        }
      }
    } else {
      // Plain string child — inside w:del it serializes as delText.
      parts.push(isDelete ? stringifyDeletedRun(c) : stringifyRunInline({ text: c }, ctx));
    }
  }
  return parts.join("");
}

/**
 * Expand a `{ comment }` sugar child: allocate the comment id, register the
 * comment entry (side effect, consumed when word/comments.xml is stringified),
 * and emit the range markers + anchored content + reference with one shared id.
 *
 * The caller never supplies an id — the library owns id allocation and pairing.
 */
function stringifyCommentChild(c: CommentChildOptions, ctx: BodyContext): string {
  const id = ctx.file.comments.nextId++;
  ctx.file.comments.entries.push({
    id,
    author: c.author,
    initials: c.initials,
    date: c.date,
    children: c.children,
  });

  return (
    `<w:commentRangeStart w:id="${id}"/>` +
    stringifyInlineWrap(c.wrap, ctx) +
    `<w:commentRangeEnd w:id="${id}"/>` +
    `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${id}"/></w:r>`
  );
}

/**
 * Expand a `{ bookmark }` sugar child: allocate the bookmark id and emit the
 * paired bookmarkStart/bookmarkEnd with the anchored content between them.
 * Bookmarks are pure markup — the only effect is the two markers.
 */
function stringifyBookmarkChild(b: BookmarkOptions, ctx: BodyContext): string {
  const id = ctx.file.markupIds.rangeNext++;
  const startAttrs = buildBookmarkStartAttrs({
    id,
    name: b.name,
    displacedByCustomXml: b.displacedByCustomXml,
    colFirst: b.colFirst,
    colLast: b.colLast,
  });
  const endAttrs = buildMarkupRangeAttrs({ id, displacedByCustomXml: b.displacedByCustomXml });
  return `<w:bookmarkStart ${startAttrs}/>${stringifyInlineWrap(b.wrap, ctx)}<w:bookmarkEnd ${endAttrs}/>`;
}

/**
 * Expand a `{ moveFrom }` / `{ moveTo }` sugar child: allocate the range id and
 * the move-run id, then emit the paired range markers with the moved run between
 * them. The move run (CT_TrackChange) carries the moved content.
 */
function stringifyMoveRangeChild(
  kind: "moveFrom" | "moveTo",
  opts: MoveRangeOptions,
  ctx: BodyContext,
): string {
  const rangeId = ctx.file.markupIds.rangeNext++;
  const runId = ctx.file.markupIds.moveRunNext++;
  const isMoveFrom = kind === "moveFrom";
  const startTag = isMoveFrom ? "w:moveFromRangeStart" : "w:moveToRangeStart";
  const endTag = isMoveFrom ? "w:moveFromRangeEnd" : "w:moveToRangeEnd";
  const runTag = isMoveFrom ? "w:moveFrom" : "w:moveTo";
  const rangeStartAttrs = buildMoveRangeStartAttrs({
    id: rangeId,
    name: opts.name,
    author: opts.author,
    date: opts.date,
    displacedByCustomXml: opts.displacedByCustomXml,
    colFirst: opts.colFirst,
    colLast: opts.colLast,
  });
  const endAttrs = buildMarkupRangeAttrs({
    id: rangeId,
    displacedByCustomXml: opts.displacedByCustomXml,
  });
  return (
    `<${startTag} ${rangeStartAttrs}/>` +
    `<${runTag} w:id="${runId}" w:author="${escapeXml(opts.author)}" w:date="${opts.date}">${stringifyInlineWrap(opts.wrap, ctx)}</${runTag}>` +
    `<${endTag} ${endAttrs}/>`
  );
}

function runPropertiesXml(child: ParagraphChild): string {
  return stringifyRunProperties(child as RunOptions) ?? "";
}

/**
 * The plain-run shape the dispatch text fast path claims: text set, with none
 * of the variants that legally coexist with text and have their own dispatch
 * branch (references, the { text, hyperlink } shorthand). Callers that need
 * context-specific text spelling (w:delText inside a deletion wrapper) use
 * this to claim the shape before dispatch does.
 */
function isPlainTextRun(child: ParagraphChild): boolean {
  const run = child as RunOptions;
  return (
    "text" in child &&
    run.text !== undefined &&
    run.footnoteReference === undefined &&
    run.endnoteReference === undefined &&
    !("commentReference" in child) &&
    !("hyperlink" in child)
  );
}

export function stringifyChildDispatch(
  child: ParagraphChild,
  ctx: BodyContext,
): string | string[] | undefined {
  // Verbatim passthrough (unrecognized drawings and other shapes the parse
  // path keeps byte-faithful) — comes first so no run-like branch claims it.
  if ("rawXml" in child) {
    return child.rawXml;
  }
  // Fast path: a plain run with text set is by far the most common child.
  // The chain below otherwise runs ~40 discriminant checks before the caller
  // falls back to stringifyRunInline — the exact function this returns.
  if (isPlainTextRun(child)) {
    return stringifyRunInline(child as RunOptions, ctx);
  }
  // Simple break types — pure XML, no side effects. A break run may carry run
  // properties (round-tripped from <w:r><w:rPr>…</w:rPr><w:br…/></w:r>).
  if ("pageBreak" in child) {
    return `<w:r>${runPropertiesXml(child)}<w:br w:type="page"/></w:r>`;
  }
  if ("columnBreak" in child) {
    return `<w:r>${runPropertiesXml(child)}<w:br w:type="column"/></w:r>`;
  }
  if ("tab" in child) {
    return `<w:r>${runPropertiesXml(child)}<w:tab/></w:r>`;
  }
  // Sub-document insertion (w:subDoc, EG_PContent member like hyperlink — no
  // run wrapper, the element sits directly in the paragraph)
  if ("subDoc" in child) {
    return subDocDesc.stringify(child.subDoc, ctx) ?? "";
  }

  // Reference types — pure XML, no side effects
  const fnRefChild = (child as RunOptions).footnoteReference;
  if (fnRefChild !== undefined) {
    const id = typeof fnRefChild === "number" ? fnRefChild : fnRefChild.id;
    const cmf =
      typeof fnRefChild === "object" && fnRefChild.customMarkFollows
        ? ' w:customMarkFollows="1"'
        : "";
    // Round-tripped run properties win; a fresh reference gets the
    // conventional FootnoteReference character style. A RunOptions-flavored
    // child carries them flattened, so read both shapes.
    const props = "properties" in child ? child.properties : undefined;
    const rPr = props
      ? (stringifyRunProperties(props) ?? "")
      : '<w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>';
    return `<w:r>${rPr}<w:footnoteReference w:id="${id}"${cmf}/></w:r>`;
  }
  const enRefChild = (child as RunOptions).endnoteReference;
  if (enRefChild !== undefined) {
    const id = typeof enRefChild === "number" ? enRefChild : enRefChild.id;
    const cmf =
      typeof enRefChild === "object" && enRefChild.customMarkFollows
        ? ' w:customMarkFollows="1"'
        : "";
    const props = "properties" in child ? child.properties : undefined;
    const rPr = props
      ? (stringifyRunProperties(props) ?? "")
      : '<w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr>';
    return `<w:r>${rPr}<w:endnoteReference w:id="${id}"${cmf}/></w:r>`;
  }

  // Comment sugar — library allocates the id, emits the range markers +
  // reference, and registers the comment entry (see stringifyCommentChild).
  if ("comment" in child) return stringifyCommentChild(child.comment, ctx);

  // Comment markers — pure XML
  if ("commentRangeStart" in child)
    return `<w:commentRangeStart ${buildMarkupRangeAttrs(child.commentRangeStart)}/>`;
  if ("commentRangeEnd" in child)
    return `<w:commentRangeEnd ${buildMarkupRangeAttrs(child.commentRangeEnd)}/>`;
  if ("commentReference" in child) {
    // Run properties parsed with the reference survive verbatim — Word does
    // not always style comment references, so nothing is injected.
    const rPr = child.properties ? (stringifyRunProperties(child.properties) ?? "") : "";
    return `<w:r>${rPr}<w:commentReference w:id="${child.commentReference}"/></w:r>`;
  }

  // Bookmark markers — pure XML
  if ("bookmarkStart" in child) {
    return `<w:bookmarkStart ${buildBookmarkStartAttrs(child.bookmarkStart)}/>`;
  }
  if ("bookmarkEnd" in child) {
    return `<w:bookmarkEnd ${buildMarkupRangeAttrs(child.bookmarkEnd)}/>`;
  }
  // Bookmark sugar — library allocates the id and pairs start/end.
  if ("bookmark" in child) return stringifyBookmarkChild(child.bookmark, ctx);

  // Symbol runs are self-closing elements, not text: emit them directly so
  // they are not escaped into a <w:t> by the run children path.
  if ("symbolRun" in child) {
    const opts = child.symbolRun;
    const rPr = stringifyRunProperties(opts) ?? "";
    return `<w:r>${rPr}${stringifySymbolRunInner(opts)}</w:r>`;
  }

  // OLE object run — the parse path flattens a pure w:object run to a bare
  // { object } paragraph child (with run properties merged in), so emit its
  // own <w:r> here rather than falling through to the run-children path.
  if ("object" in child) {
    const rPr = stringifyRunProperties(child as RunOptions) ?? "";
    return `<w:r>${rPr}${objectDesc.stringify(child.object, ctx)}</w:r>`;
  }

  // VML picture run — same flattening: a bare { pict } child carries its run
  // properties merged in, and w:pict is emitted inside its own <w:r>.
  if ("pict" in child) {
    const rPr = stringifyRunProperties(child as RunOptions) ?? "";
    return `<w:r>${rPr}${stringifyPict(child.pict, ctx)}</w:r>`;
  }

  // Form field (checkbox / dropdown list / text input) — fldChar sequence.
  // Word needs the field code (instrText) between begin and separate to
  // recognize the field type and render its result.
  if ("formField" in child) {
    const ff = child.formField;
    let result = "";
    let instrCode = "";
    let symbolFont = false;
    if (ff.checkBox) {
      result = ff.checkBox.checked ? "☒" : "☐";
      instrCode = "FORMCHECKBOX";
      // U+2610/U+2612 are absent from common body fonts (Calibri/Times);
      // MS Gothic holds them and matches the SDT w14:checkbox default.
      symbolFont = true;
    } else if (ff.dropDownList) {
      const idx = ff.dropDownList.result ?? ff.dropDownList.default;
      result = idx !== undefined ? (ff.dropDownList.entries[idx] ?? "") : "";
      instrCode = "FORMDROPDOWN";
    } else if (ff.textInput) {
      // Prefer the user-entered value (result run) over the placeholder default.
      result = ff.textInput.value ?? ff.textInput.default ?? "";
      instrCode = "FORMTEXT";
    }
    const rPr = symbolFont
      ? '<w:rPr><w:rFonts w:ascii="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr>'
      : "";
    return (
      `<w:r>${createBegin(false, ff)}</w:r>` +
      `<w:r><w:instrText xml:space="preserve"> ${instrCode} </w:instrText></w:r>` +
      `<w:r>${createSeparate()}</w:r>` +
      `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(result)}</w:t></w:r>` +
      `<w:r>${createEnd()}</w:r>`
    );
  }

  // Drawing-family children — picture, chart, SmartArt, WPS shape,
  // contentPart, and wpgGroup (media/part registration + descriptor
  // stringification live in ./inline-drawings).
  const drawingXml = stringifyDrawingChild(child, ctx);
  if (drawingXml !== undefined) return drawingXml;

  // Math — pure string concatenation. A justification or the display flag
  // wraps the equation in a display m:oMathPara; without it stays inline m:oMath.
  if ("math" in child && typeof child.math === "object" && child.math !== null) {
    const mathOpts = child.math;
    const children = mathOpts.children ?? [];
    if (mathOpts.display || mathOpts.justification !== undefined) {
      return stringifyMathParagraph(children, mathOpts.justification);
    }
    return stringifyMath(children);
  }

  // Inserted text run(s) — w:ins wraps one or more runs (CT_RunTrackChange)
  if ("insertion" in child) {
    const { id, author, date, children } = child.insertion;
    const body = stringifyTrackChangeChildren(children, ctx, false);
    return `<w:ins w:id="${id ?? autoRevisionId()}" w:author="${escapeXml(String(author))}" w:date="${date}">${body}</w:ins>`;
  }

  // Deleted text run(s) — w:del wraps one or more runs (delText content)
  if ("deletion" in child) {
    const { id, author, date, children } = child.deletion;
    const body = stringifyTrackChangeChildren(children, ctx, true);
    return `<w:del w:id="${id ?? autoRevisionId()}" w:author="${escapeXml(String(author))}" w:date="${date}">${body}</w:del>`;
  }

  // Hyperlink — side effect: relationship registration
  if ("hyperlink" in child) {
    const hl = child.hyperlink;

    // Serialize children using the same dispatch as paragraph children so
    // reference runs, drawings and objects inside hyperlinks keep their
    // full-run emission ({ footnoteReference, properties } carries the rPr in
    // a nested field only the dispatch branch reads). Plain runs fall back to
    // stringifyRunInline. A top-level `text` is a shorthand for a single text
    // run; without it `{ text, hyperlink }` would emit an empty <w:hyperlink>.
    const childParts: string[] = [];
    if (child.text !== undefined) {
      childParts.push(stringifyRunInline({ text: child.text }, ctx));
    }
    if (hl.children) {
      for (const rc of hl.children) {
        if (typeof rc === "string") {
          childParts.push(stringifyRunInline({ text: rc }, ctx));
        } else {
          const jr = stringifyChildDispatch(rc as ParagraphChild, ctx);
          childParts.push(
            jr !== undefined
              ? Array.isArray(jr)
                ? jr.join("")
                : jr
              : stringifyRunInline(rc as RunOptions, ctx),
          );
        }
      }
    }
    const body = childParts.join("");

    const pushHlAttrs = (attrs: string[]): void => {
      // Presence-based: an unset history keeps the source's attribute-less
      // form (injecting "1" here would oscillate across re-generations —
      // absent parses back as undefined, which would then inject "1").
      if (hl.history !== undefined) attrs.push(`w:history="${hl.history ? "1" : "0"}"`);
      if (hl.tooltip) attrs.push(`w:tooltip="${escapeXml(hl.tooltip)}"`);
      if (hl.targetFrame) attrs.push(`w:tgtFrame="${escapeXml(hl.targetFrame)}"`);
      if (hl.docLocation) attrs.push(`w:docLocation="${escapeXml(hl.docLocation)}"`);
    };
    if (hl.url) {
      // Auto-allocated sequential id — deterministic across runs, so a
      // re-generated document keeps byte-stable relationships (random ids
      // would drift on every compile). Later media/embedding offsets sample
      // relationshipCount after this registration, so no id collision.
      // One relationship per hyperlink element — Word emits a distinct rel
      // per reference even when the URL repeats (sharing would collapse the
      // source's per-reference entries on round-trip).
      const relType = RELATIONSHIP_TYPES.hyperlink;
      const linkId = `rId${ctx.viewWrapper.relationships.add(relType, hl.url, TargetModeType.EXTERNAL)}`;
      const attrs = [`r:id="${linkId}"`];
      pushHlAttrs(attrs);
      return `<w:hyperlink ${attrs.join(" ")}>${body}</w:hyperlink>`;
    }
    if (hl.anchor) {
      const attrs = [`w:anchor="${escapeXml(hl.anchor)}"`];
      pushHlAttrs(attrs);
      return `<w:hyperlink ${attrs.join(" ")}>${body}</w:hyperlink>`;
    }
    return "";
  }

  // ── Proof error markers ──
  if ("proofErr" in child) return `<w:proofErr w:type="${child.proofErr}"/>`;

  // ── Positional tab ──
  if ("positionalTab" in child) {
    const pt = child.positionalTab;
    return `<w:ptab w:alignment="${pt.alignment}" w:leader="${pt.leader}" w:relativeTo="${pt.relativeTo}"/>`;
  }

  // ── Permission range markers ──
  if ("permStart" in child) {
    const ps = child.permStart;
    const a: string[] = [`w:id="${ps.id ?? autoRevisionId()}"`];
    if (ps.editor !== undefined) a.push(`w:ed="${escapeXml(String(ps.editor))}"`);
    if (ps.editGroup !== undefined) a.push(`w:edGrp="${ps.editGroup}"`);
    if (ps.colFirst !== undefined) a.push(`w:colFirst="${ps.colFirst}"`);
    if (ps.colLast !== undefined) a.push(`w:colLast="${ps.colLast}"`);
    return `<w:permStart ${a.join(" ")}/>`;
  }
  if ("permEnd" in child) return `<w:permEnd w:id="${child.permEnd}"/>`;

  // ── Move revision range markers ──
  if ("moveFromRangeStart" in child) {
    return `<w:moveFromRangeStart ${buildMoveRangeStartAttrs(child.moveFromRangeStart)}/>`;
  }
  if ("moveFromRangeEnd" in child)
    return `<w:moveFromRangeEnd ${buildMarkupRangeAttrs(child.moveFromRangeEnd)}/>`;
  if ("moveToRangeStart" in child) {
    return `<w:moveToRangeStart ${buildMoveRangeStartAttrs(child.moveToRangeStart)}/>`;
  }
  if ("moveToRangeEnd" in child)
    return `<w:moveToRangeEnd ${buildMarkupRangeAttrs(child.moveToRangeEnd)}/>`;
  // Move revision sugar — library allocates range + run ids and pairs markers.
  if ("moveFrom" in child) return stringifyMoveRangeChild("moveFrom", child.moveFrom, ctx);
  if ("moveTo" in child) return stringifyMoveRangeChild("moveTo", child.moveTo, ctx);

  // ── Move revision text runs ──
  if ("movedFrom" in child) {
    const { id, author, date, children } = child.movedFrom;
    const body = stringifyTrackChangeChildren(children, ctx, false);
    return `<w:moveFrom w:id="${id ?? autoRevisionId()}" w:author="${escapeXml(String(author))}" w:date="${date}">${body}</w:moveFrom>`;
  }
  if ("movedTo" in child) {
    const { id, author, date, children } = child.movedTo;
    const body = stringifyTrackChangeChildren(children, ctx, false);
    return `<w:moveTo w:id="${id ?? autoRevisionId()}" w:author="${escapeXml(String(author))}" w:date="${date}">${body}</w:moveTo>`;
  }

  // ── Custom XML range markers (track changes) ──
  if ("customXmlInsRangeStart" in child) {
    const o = child.customXmlInsRangeStart;
    return `<w:customXmlInsRangeStart w:id="${o.id}"${o.author ? ` w:author="${escapeXml(o.author)}"` : ""}${o.date ? ` w:date="${o.date}"` : ""}/>`;
  }
  if ("customXmlInsRangeEnd" in child)
    return `<w:customXmlInsRangeEnd w:id="${child.customXmlInsRangeEnd}"/>`;
  if ("customXmlDelRangeStart" in child) {
    const o = child.customXmlDelRangeStart;
    return `<w:customXmlDelRangeStart w:id="${o.id}"${o.author ? ` w:author="${escapeXml(o.author)}"` : ""}${o.date ? ` w:date="${o.date}"` : ""}/>`;
  }
  if ("customXmlDelRangeEnd" in child)
    return `<w:customXmlDelRangeEnd w:id="${child.customXmlDelRangeEnd}"/>`;
  if ("customXmlMoveFromRangeStart" in child) {
    const o = child.customXmlMoveFromRangeStart;
    return `<w:customXmlMoveFromRangeStart w:id="${o.id}"${o.author ? ` w:author="${escapeXml(o.author)}"` : ""}${o.date ? ` w:date="${o.date}"` : ""}/>`;
  }
  if ("customXmlMoveFromRangeEnd" in child)
    return `<w:customXmlMoveFromRangeEnd w:id="${child.customXmlMoveFromRangeEnd}"/>`;
  if ("customXmlMoveToRangeStart" in child) {
    const o = child.customXmlMoveToRangeStart;
    return `<w:customXmlMoveToRangeStart w:id="${o.id}"${o.author ? ` w:author="${escapeXml(o.author)}"` : ""}${o.date ? ` w:date="${o.date}"` : ""}/>`;
  }
  if ("customXmlMoveToRangeEnd" in child)
    return `<w:customXmlMoveToRangeEnd w:id="${child.customXmlMoveToRangeEnd}"/>`;

  // ── Simple field ──
  if ("simpleField" in child) {
    const sf = child.simpleField;
    const sfAttrs = [`w:instr="${escapeXml(sf.instruction)}"`];
    if (sf.fieldLock !== undefined) sfAttrs.push(`w:fldLock="${sf.fieldLock ? 1 : 0}"`);
    if (sf.dirty !== undefined) sfAttrs.push(`w:dirty="${sf.dirty ? 1 : 0}"`);
    if (sf.cachedRunsXml !== undefined) {
      return `<w:fldSimple ${sfAttrs.join(" ")}>${sf.cachedRunsXml}</w:fldSimple>`;
    }
    if (sf.cachedValue !== undefined) {
      return `<w:fldSimple ${sfAttrs.join(" ")}><w:r><w:t>${escapeXml(sf.cachedValue)}</w:t></w:r></w:fldSimple>`;
    }
    return `<w:fldSimple ${sfAttrs.join(" ")}/>`;
  }

  // ── Complex field (PAGE/DATE/TOC/... — fldChar field without w:ffData) ──
  if ("complexField" in child) {
    return stringifyComplexFieldRuns(child.complexField);
  }

  // ── Sequential identifier (SEQ field) ──
  if ("seqIdentifier" in child) {
    const id = child.seqIdentifier;
    return (
      "<w:r>" +
      '<w:fldChar w:fldCharType="begin"/>' +
      `<w:instrText xml:space="preserve"> SEQ ${escapeXml(id)} </w:instrText>` +
      '<w:fldChar w:fldCharType="separate"/>' +
      '<w:fldChar w:fldCharType="end"/>' +
      "</w:r>"
    );
  }

  // ── Page reference (PAGEREF field) ──
  if ("pageReference" in child) {
    const pr = child.pageReference;
    let instr = ` PAGEREF ${escapeXml(pr.bookmarkId)} `;
    if (pr.hyperlink) instr += "\\h ";
    if (pr.useRelativePosition) instr += "\\p ";
    return (
      "<w:r>" +
      '<w:fldChar w:fldCharType="begin"/>' +
      `<w:instrText xml:space="preserve">${instr}</w:instrText>` +
      '<w:fldChar w:fldCharType="end"/>' +
      "</w:r>"
    );
  }

  // ── Bidirectional text containers ──
  if ("dir" in child) {
    const d = child.dir;
    const childXml = serializeDispatchChildren(d.children, ctx);
    return `<w:dir w:val="${d.val}">${childXml}</w:dir>`;
  }
  if ("bdo" in child) {
    const b = child.bdo;
    const childXml = serializeDispatchChildren(b.children, ctx);
    return `<w:bdo w:val="${b.val}">${childXml}</w:bdo>`;
  }

  // ── Smart tag ──
  if ("smartTag" in child) {
    const st = child.smartTag;
    const attrs: string[] = [];
    if (st.uri) attrs.push(`w:uri="${escapeXml(st.uri)}"`);
    attrs.push(`w:element="${escapeXml(st.element)}"`);

    const parts: string[] = [];
    if (st.properties?.length) {
      const propParts: string[] = [];
      for (const p of st.properties) {
        const pa: string[] = [];
        if (p.uri) pa.push(`w:uri="${escapeXml(p.uri)}"`);
        pa.push(`w:name="${escapeXml(p.name)}"`, `w:val="${escapeXml(p.val)}"`);
        propParts.push(`<w:attr ${pa.join(" ")}/>`);
      }
      parts.push(`<w:smartTagPr>${propParts.join("")}</w:smartTagPr>`);
    }
    parts.push(serializeDispatchChildren(st.children, ctx));
    return `<w:smartTag ${attrs.join(" ")}>${parts.join("")}</w:smartTag>`;
  }

  // ── Custom XML run (CT_CustomXmlRun) ──
  if ("customXml" in child) {
    const cx = child.customXml;
    return stringifyCustomXmlShell(cx, serializeDispatchChildren(cx.children, ctx));
  }

  // ── Inline structured document tag (CT_SdtRun) ──
  if ("sdt" in child) {
    const s = child.sdt;
    let contentXml = "";
    if (s.properties.checkbox) {
      // Inline checkbox: render the state symbol as a run (no <w:p> wrapper).
      contentXml = checkboxSymbolRunInner(s.properties.checkbox);
    } else if (s.children && s.children.length > 0) {
      const cparts: string[] = [];
      for (const c of s.children) {
        if (typeof c === "string") {
          cparts.push(stringifyRunInline({ text: c }, ctx));
        } else {
          const jr = stringifyChildDispatch(c as ParagraphChild, ctx);
          if (jr !== undefined) {
            cparts.push(Array.isArray(jr) ? jr.join("") : jr);
          } else if ("text" in c || "children" in c || "break" in c) {
            cparts.push(stringifyRunInline(c as RunOptions, ctx));
          }
        }
      }
      contentXml = cparts.join("");
    }
    return stringifySdtShell(s.properties, s.endProperties, contentXml);
  }

  return undefined;
}

/**
 * Serialize `(ParagraphChild | string)[]` content: each child goes through the
 * JSON dispatch, with an unconditional run fallback for unrecognized wrappers
 * (shared by Dir/Bdo, smartTag and customXml). Sdt and paragraph children use
 * their own loops — their fallback-drop semantics differ.
 */
function serializeDispatchChildren(
  children: (ParagraphChild | string)[] | undefined,
  ctx: BodyContext,
): string {
  if (!children) return "";
  let body = "";
  for (const c of children) {
    if (typeof c === "string") {
      body += stringifyRunInline({ text: c }, ctx);
      continue;
    }
    const jr = stringifyChildDispatch(c, ctx);
    body +=
      jr !== undefined
        ? Array.isArray(jr)
          ? jr.join("")
          : jr
        : stringifyRunInline(c as RunOptions, ctx);
  }
  return body;
}

// ── Paragraph ──

export function stringifyParagraphInline(
  opts: string | ParagraphOptions,
  ctx: BodyContext,
): string {
  const resolved: ParagraphOptions = typeof opts === "string" ? { text: opts } : opts;
  let body = "";

  const props = stringifyParagraphProperties(resolved);
  if (props.xml) body += props.xml;

  // Register numbering references from inline paragraphs (footnotes, endnotes, etc.)
  // so that concrete numbering instances are created and placeholders get resolved.
  if (props.numberingReferences.length > 0) {
    for (const ref of props.numberingReferences) {
      ctx.file.numbering.createConcreteNumberingInstance(ref.reference, ref.instance);
    }
  }

  if (resolved.text !== undefined) {
    body += stringifyRunInline({ text: resolved.text }, ctx);
  }

  if (resolved.children) {
    for (const child of resolved.children) {
      if (typeof child === "string") {
        body += stringifyRunInline({ text: child }, ctx);
      } else if (typeof child === "object" && child !== null) {
        // Try JSON child dispatch first (image, chart, hyperlink, etc.)
        const jsonResult = stringifyChildDispatch(child as ParagraphChild, ctx);
        if (jsonResult !== undefined) {
          body += Array.isArray(jsonResult) ? jsonResult.join("") : jsonResult;
        } else {
          // RunOptions-like plain object — may be an empty run carrying only
          // run properties (round-tripped from <w:r><w:rPr>…</w:rPr></w:r>);
          // same fallback contract as the body-level paragraph stringifier.
          body += stringifyRunInline(child as RunOptions, ctx);
        }
      }
    }
  }

  // Identity attributes — inline containers (comments, footnotes, headers)
  // round-trip the body-level identity set too; w15:commentEx links comment
  // replies through w14:paraId.
  const attr = paragraphIdentityAttrs(resolved);
  return body ? `<w:p${attr}>${body}</w:p>` : `<w:p${attr}/>`;
}
