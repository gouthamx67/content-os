export type BrandVisualDefaults = {
  backgroundColor: string | null;
  surfaceColor: string | null;
  textColor: string | null;
  headingFont: string | null;
  bodyFont: string | null;
};

const EMPTY_DEFAULTS: BrandVisualDefaults = {
  backgroundColor: null,
  surfaceColor: null,
  textColor: null,
  headingFont: null,
  bodyFont: null,
};

/**
 * The colours and fonts a new composition can start from.
 *
 * Read live from CP08 rather than copied into the visual engine: a brand that is
 * re-analysed should change what a *new* composition defaults to, while existing
 * layers keep whatever they were given. This is a default source, not a second
 * brand store.
 */
export async function brandVisualDefaults(
  projectId: string,
): Promise<BrandVisualDefaults> {
  const { db } = await import("../../../prisma/db");

  const profile = await db.orm.public.BrandProfile.where({ projectId }).first();

  if (!profile) {
    return { ...EMPTY_DEFAULTS };
  }

  const [background, surface, text, heading, body] = await Promise.all([
    db.orm.public.BrandColor.where({
      profileId: profile.id,
      role: "BACKGROUND",
    }).first(),
    db.orm.public.BrandColor.where({
      profileId: profile.id,
      role: "SURFACE",
    }).first(),
    db.orm.public.BrandColor.where({
      profileId: profile.id,
      role: "TEXT",
    }).first(),
    db.orm.public.BrandFont.where({
      profileId: profile.id,
      role: "HEADING",
    }).first(),
    db.orm.public.BrandFont.where({
      profileId: profile.id,
      role: "BODY",
    }).first(),
  ]);

  return {
    backgroundColor: background?.hex ?? null,
    surfaceColor: surface?.hex ?? null,
    textColor: text?.hex ?? null,
    headingFont: heading?.family ?? null,
    bodyFont: body?.family ?? null,
  };
}
