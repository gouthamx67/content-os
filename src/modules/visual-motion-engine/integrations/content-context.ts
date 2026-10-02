/**
 * Reads the storyboard scene a composition is built for, if any.
 *
 * It is a read, not a copy: the composition stores the scene id and nothing
 * else, so editing the scene in CP11 does not silently diverge from a duplicated
 * title here.
 */
export type ShotContext = {
  shotId: string;
  name: string;
  durationMs: number;
};

export async function shotContext(
  projectId: string,
  shotId: string,
): Promise<ShotContext | null> {
  const { db } = await import("../../../prisma/db");

  const scene = await db.orm.public.StoryboardScene.where({ id: shotId }).first();

  if (!scene) {
    return null;
  }

  const storyboard = await db.orm.public.Storyboard.where({
    id: scene.storyboardId,
  }).first();

  if (!storyboard || storyboard.projectId !== projectId) {
    return null;
  }

  return {
    shotId,
    name: scene.name,
    durationMs: scene.durationMs,
  };
}
