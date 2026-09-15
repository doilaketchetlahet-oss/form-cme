import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
  render,
} from "@react-email/components";
import {
  fillMergeTokens,
  getTemplateFlags,
  isVisualEmailTemplate,
  normalizeEmailTheme,
  overlayEmailHtml,
  parseEmailTemplate,
  type EmailBlock,
  type EmailTheme,
} from "@/lib/email-template";

function alignCss(align?: EmailBlock["align"]) {
  return align === "right" ? "right" : align === "center" ? "center" : "left";
}

function clamp(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(value ?? fallback, max));
}

function renderBlock(block: EmailBlock, theme: ReturnType<typeof normalizeEmailTheme>, qrImgUrl: string) {
  const textAlign = alignCss(block.align);

  if (block.type === "heading") {
    return (
      <Heading
        key={block.id}
        as="h2"
        style={{
          margin: "0 0 12px",
          textAlign,
          color: block.color || theme.headingColor,
          fontSize: clamp(block.fontSize, 16, 36, theme.headingSize),
          lineHeight: 1.3,
          fontWeight: block.bold === false ? 500 : 700,
        }}
      >
        {block.text || ""}
      </Heading>
    );
  }

  if (block.type === "text") {
    return (
      <Text
        key={block.id}
        style={{
          margin: "0 0 14px",
          textAlign,
          color: block.color || theme.textColor,
          fontSize: clamp(block.fontSize, 12, 20, theme.textSize),
          lineHeight: 1.6,
          fontWeight: block.bold ? 700 : 400,
          whiteSpace: "pre-wrap",
        }}
      >
        {block.text || ""}
      </Text>
    );
  }

  if (block.type === "image" && block.url) {
    return (
      <Section key={block.id} style={{ textAlign, margin: "0 0 16px" }}>
        <Img src={block.url} alt={block.alt || ""} style={{ maxWidth: "100%", height: "auto", borderRadius: 12, display: "inline-block" }} />
      </Section>
    );
  }

  if (block.type === "button") {
    return (
      <Section key={block.id} style={{ textAlign, margin: "4px 0 18px" }}>
        <Button
          href={block.url || "{{checkin_url}}"}
          style={{
            backgroundColor: block.buttonColor || theme.buttonColor,
            color: "#ffffff",
            textDecoration: "none",
            padding: "12px 18px",
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 700,
            display: "inline-block",
          }}
        >
          {block.text || "Mở liên kết"}
        </Button>
      </Section>
    );
  }

  if (block.type === "qr") {
    const size = clamp(block.qrSize, 140, 280, 220);
    return (
      <Section key={block.id} style={{ textAlign, margin: "8px 0 18px" }}>
        <Img
          src={qrImgUrl || "{{qr_image}}"}
          alt="Mã QR check-in"
          width={size}
          height={size}
          style={{ width: size, height: size, borderRadius: 12, border: "1px solid #e2e8f0", display: "inline-block" }}
        />
      </Section>
    );
  }

  if (block.type === "divider") {
    return <Hr key={block.id} style={{ borderColor: "#e2e8f0", margin: "8px 0 18px" }} />;
  }

  if (block.type === "spacer") {
    const height = clamp(block.height, 8, 80, 16);
    return <Section key={block.id} style={{ height, lineHeight: `${height}px`, fontSize: 1 }}>&nbsp;</Section>;
  }

  if (block.type === "html") {
    return <Section key={block.id} dangerouslySetInnerHTML={{ __html: block.text || "" }} />;
  }

  return null;
}

async function renderBlocksToHtml(blocks: EmailBlock[], themeInput: EmailTheme | null | undefined, qrImgUrl: string) {
  const theme = normalizeEmailTheme(themeInput);
  const element = (
    <Html>
      <Head />
      <Preview>{""}</Preview>
      <Body
        style={{
          margin: 0,
          padding: "24px 12px",
          background: theme.background,
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <Container
          style={{
            maxWidth: 520,
            margin: "0 auto",
            background: theme.card,
            borderRadius: 16,
            padding: "28px 24px",
            color: theme.textColor,
            lineHeight: 1.55,
          }}
        >
          {theme.logoUrl ? (
            <Img
              src={theme.logoUrl}
              alt=""
              style={{ maxHeight: 56, maxWidth: 180, height: "auto", display: "block", margin: "0 auto 18px" }}
            />
          ) : null}
          {blocks.map((block) => renderBlock(block, theme, qrImgUrl))}
          {theme.footer ? (
            <Text
              style={{
                color: "#94a3b8",
                fontSize: 12,
                lineHeight: 1.6,
                textAlign: "center",
                margin: "18px 0 0",
                whiteSpace: "pre-wrap",
              }}
            >
              {theme.footer}
            </Text>
          ) : null}
        </Container>
      </Body>
    </Html>
  );

  return render(element);
}

/**
 * Server-side email HTML build for the check-in / invitation pipeline.
 * Uses React Email for block templates, then fills merge tokens.
 */
export async function renderCheckinEmailHtml(
  raw: string | null | undefined,
  values: Record<string, string>,
  qrImgUrl = "",
): Promise<string> {
  const source = String(raw ?? "").trim();
  if (!source) return "";
  if (!isVisualEmailTemplate(source)) {
    return fillMergeTokens(source, values, qrImgUrl);
  }

  const template = parseEmailTemplate(source);
  const flags = getTemplateFlags(source);
  const parts: string[] = [];

  if (flags.overlay && template.overlay?.imageUrl) parts.push(overlayEmailHtml());
  if (flags.blocks) parts.push(await renderBlocksToHtml(template.blocks, template.theme, qrImgUrl));

  return fillMergeTokens(parts.join(""), values, qrImgUrl);
}
