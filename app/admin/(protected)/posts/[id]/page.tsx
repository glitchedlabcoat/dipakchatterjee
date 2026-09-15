// app/admin/(protected)/posts/[id]/page.tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/utils/supabase/server";
import { POST_BUCKET, type Post, type PostMedia } from "@/types/domain";
import MediaManager from "@/components/admin/MediaManager";
import DeleteEntityButton from "@/components/admin/DeleteEntityButton";
import PostForm from "../PostForm";
import PostThumbnailUploader from "../PostThumbnailUploader";
import {
  addPostMedia,
  deletePost,
  deletePostMedia,
  reorderPostMedia,
  updatePost,
} from "../actions";

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: post }, { data: media }] = await Promise.all([
    supabase.from("posts").select("*").eq("id", id).single(),
    supabase
      .from("post_media")
      .select("*")
      .eq("post_id", id)
      .order("display_order", { ascending: true }),
  ]);

  if (!post) notFound();

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/posts"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-600 hover:text-navy-900 mb-6"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Posts
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-sm font-semibold text-saffron-600 mb-2">Edit Post</p>
          <h1 className="font-display text-3xl text-navy-900">
            {post.title || "Untitled update"}
          </h1>
        </div>

        <DeleteEntityButton
          label="Delete post"
          confirmMessage="Delete this post and all its media? This cannot be undone."
          redirectTo="/admin/posts"
          onDelete={deletePost.bind(null, id)}
        />
      </div>

      <div className="bg-white border border-line rounded-xl p-6 md:p-8 mb-6">
        <PostForm post={post as Post} onSubmit={updatePost.bind(null, id)} />
      </div>

      <div className="bg-white border border-line rounded-xl p-6 md:p-8 mb-6">
        <PostThumbnailUploader postId={id} currentUrl={(post as Post).thumbnail_url} />
      </div>

      <div className="bg-white border border-line rounded-xl p-6 md:p-8">
        <MediaManager
          folder={POST_BUCKET}
          entityId={id}
          media={(media as PostMedia[]) ?? []}
          addAction={addPostMedia.bind(null, id)}
          deleteAction={deletePostMedia.bind(null, id)}
          reorderAction={reorderPostMedia.bind(null, id)}
        />
      </div>
    </div>
  );
}
