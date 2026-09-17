// app/admin/(protected)/posts/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { logDashboardActivity } from "@/lib/activity-log";
import { TAG_POST_ITEM, TAG_POSTS_LIST, revalidatePublicTag } from "@/lib/cache";
import { deleteStoredMedia, deleteStoredMediaBatch } from "@/lib/storage-delete";
import { parseValidDate } from "@/lib/safe-date";
import { POST_BUCKET, type MediaKind, type PostLink } from "@/types/domain";

// `input.published_at` traces back to an admin's datetime-local/date
// input (PostForm.tsx), not a DB column — a truthy check alone doesn't
// guarantee it's a parseable date (native pickers only ever produce a
// well-formed string or "", but a devtools-edited/extension-injected
// value could still slip an unparseable one through PostForm's own zod
// .refine()). new Date(garbage).toISOString() throws
// "RangeError: Invalid time value", which is exactly the intermittent
// production crash this guards against. Invalid input is treated the
// same as empty: the key is omitted so the column's `default now()`
// applies, rather than 500ing the whole save.
function toValidPublishedAt(value: string): { published_at: string } | Record<string, never> {
  const d = parseValidDate(value);
  return d ? { published_at: d.toISOString() } : {};
}

// Every mutation below changes either which posts are published/how
// they're ordered (-> TAG_POSTS_LIST) or one specific post's own
// content (-> TAG_POST_ITEM(id)) — see lib/queries/posts.ts for the
// reads tagged with these. Deliberately not revalidatePublicPages():
// that would also flush the separately-tagged settings and
// homepage-sections caches, which nothing here touches.
function revalidatePost(id: string) {
  revalidatePublicTag(TAG_POST_ITEM(id));
  revalidatePublicTag(TAG_POSTS_LIST);
}

export type PostFormInput = {
  title: string;
  body: string;
  /** "YYYY-MM-DDTHH:mm" from a datetime-local input, in the admin's local time; empty to fall back to now(). */
  published_at: string;
  /** Whether the public post page shows published_at's time alongside its date. */
  show_published_time: boolean;
  is_published: boolean;
  /** Each explicitly typed "embed" (rendered as an iframe when recognized) or "button" (always a plain CTA) — see types/domain.ts's PostLink. */
  links: PostLink[];
  /** Seconds, 0-10 (decimals allowed, e.g. 2.5); 0 disables the image carousel's auto-advance (manual arrows/dots only). */
  slideshow_interval: number;
};

function clampSlideshowInterval(value: number) {
  return Math.min(10, Math.max(0, Math.round(value)));
}

export async function createPost(input: PostFormInput) {
  const { supabase, user } = await requireAdmin();

  const { data, error } = await supabase
    .from("posts")
    .insert({
      title: input.title || null,
      body: input.body || null,
      // Omitted (not just null) so the column's `default now()` applies
      // when the admin leaves the picker untouched/cleared (or typed
      // something unparseable — see toValidPublishedAt above).
      ...toValidPublishedAt(input.published_at),
      show_published_time: input.show_published_time,
      is_published: input.is_published,
      links: input.links,
      slideshow_interval: clampSlideshowInterval(input.slideshow_interval),
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  await logDashboardActivity(supabase, user, {
    action: "CREATE_POST",
    entityType: "notable_works",
    entityId: data.id,
    details: `Created post: '${input.title || "Untitled update"}'`,
  });

  revalidatePath("/admin/posts");
  revalidatePublicTag(TAG_POSTS_LIST);
  redirect(`/admin/posts/${data.id}`);
}

export async function updatePost(id: string, input: PostFormInput) {
  const { supabase, user } = await requireAdmin();

  const { error } = await supabase
    .from("posts")
    .update({
      title: input.title || null,
      body: input.body || null,
      ...toValidPublishedAt(input.published_at),
      show_published_time: input.show_published_time,
      is_published: input.is_published,
      links: input.links,
      slideshow_interval: clampSlideshowInterval(input.slideshow_interval),
    })
    .eq("id", id);

  if (error) throw new Error(error.message);

  await logDashboardActivity(supabase, user, {
    action: "UPDATE_POST",
    entityType: "notable_works",
    entityId: id,
    details: `Updated post: '${input.title || "Untitled update"}'`,
  });

  revalidatePath("/admin/posts");
  revalidatePath(`/admin/posts/${id}`);
  revalidatePost(id);
}

export async function deletePost(id: string) {
  const { supabase, user } = await requireAdmin();

  const { data: post } = await supabase.from("posts").select("title").eq("id", id).single();

  const { data: media } = await supabase
    .from("post_media")
    .select("storage_path")
    .eq("post_id", id);

  if (media && media.length > 0) {
    await deleteStoredMediaBatch(supabase, POST_BUCKET, media.map((m) => m.storage_path));
  }

  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logDashboardActivity(supabase, user, {
    action: "DELETE_POST",
    entityType: "notable_works",
    entityId: id,
    details: `Deleted post: '${post?.title || "Untitled update"}'`,
  });

  revalidatePath("/admin/posts");
  revalidatePost(id);
}

export async function togglePostPublished(id: string, is_published: boolean) {
  const { supabase } = await requireAdmin();

  const { error } = await supabase
    .from("posts")
    .update({ is_published })
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath("/admin/posts");
  revalidatePost(id);
}

export async function togglePostPinned(id: string, is_pinned: boolean) {
  const { supabase, user } = await requireAdmin();

  const { data: post } = await supabase.from("posts").select("title").eq("id", id).single();

  const { error } = await supabase
    .from("posts")
    .update({ is_pinned })
    .eq("id", id);

  if (error) throw new Error(error.message);

  await logDashboardActivity(supabase, user, {
    action: "UPDATE_POST",
    entityType: "notable_works",
    entityId: id,
    details: `${is_pinned ? "Pinned" : "Unpinned"} post: '${post?.title || "Untitled update"}'`,
  });

  revalidatePath("/admin/posts");
  revalidatePost(id);
}

export async function addPostMedia(
  postId: string,
  input: { kind: MediaKind; storage_path: string; public_url: string }
) {
  const { supabase } = await requireAdmin();

  const { count } = await supabase
    .from("post_media")
    .select("*", { count: "exact", head: true })
    .eq("post_id", postId);

  // Returns the real row id — MediaManager needs it (not the storage
  // path) as the item's key/identity so a delete or reorder right after
  // upload targets the actual database row instead of failing against
  // a non-UUID "id".
  const { data, error } = await supabase
    .from("post_media")
    .insert({
      post_id: postId,
      kind: input.kind,
      storage_path: input.storage_path,
      public_url: input.public_url,
      display_order: count ?? 0,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/admin/posts/${postId}`);
  revalidatePost(postId);

  return { id: data.id };
}

export async function deletePostMedia(postId: string, mediaId: string) {
  const { supabase } = await requireAdmin();

  const { data: row } = await supabase
    .from("post_media")
    .select("storage_path")
    .eq("id", mediaId)
    .single();

  if (row) {
    await deleteStoredMedia(supabase, POST_BUCKET, row.storage_path);
  }

  const { error } = await supabase.from("post_media").delete().eq("id", mediaId);
  if (error) throw new Error(error.message);

  revalidatePath(`/admin/posts/${postId}`);
  revalidatePost(postId);
}

export async function reorderPostMedia(postId: string, orderedIds: string[]) {
  const { supabase } = await requireAdmin();

  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("post_media").update({ display_order: index }).eq("id", id)
    )
  );

  revalidatePath(`/admin/posts/${postId}`);
  revalidatePost(postId);
}

export async function updatePostThumbnail(
  postId: string,
  input: { storage_path: string; public_url: string }
) {
  const { supabase } = await requireAdmin();

  const { data: current } = await supabase
    .from("posts")
    .select("thumbnail_path")
    .eq("id", postId)
    .single();

  const { error } = await supabase
    .from("posts")
    .update({
      thumbnail_url: input.public_url,
      thumbnail_path: input.storage_path,
      updated_at: new Date().toISOString(),
    })
    .eq("id", postId);

  if (error) throw new Error(error.message);

  if (current?.thumbnail_path) {
    await deleteStoredMedia(supabase, POST_BUCKET, current.thumbnail_path);
  }

  revalidatePath(`/admin/posts/${postId}`);
  revalidatePost(postId);
}

export async function removePostThumbnail(postId: string) {
  const { supabase } = await requireAdmin();

  const { data: current } = await supabase
    .from("posts")
    .select("thumbnail_path")
    .eq("id", postId)
    .single();

  const { error } = await supabase
    .from("posts")
    .update({ thumbnail_url: null, thumbnail_path: null, updated_at: new Date().toISOString() })
    .eq("id", postId);

  if (error) throw new Error(error.message);

  if (current?.thumbnail_path) {
    await deleteStoredMedia(supabase, POST_BUCKET, current.thumbnail_path);
  }

  revalidatePath(`/admin/posts/${postId}`);
  revalidatePost(postId);
}
