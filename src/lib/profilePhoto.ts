/**
 * A student's photo (docs/TODO.md D1, 20261156000000): a 512-pixel JPEG in
 * the private profile-photos bucket, in the student's own folder, named in
 * profiles.photo_url and shown through a signed link. The initials stay the
 * fallback wherever it cannot be shown.
 *
 * A new photo is a new file: upload it, point the profile at it, then remove
 * the one it replaces — so the profile never names a file that is not there.
 */
import { supabase } from "@/integrations/supabase/client";
import { toErrorMessage } from "@/lib/presentation";

export const PROFILE_PHOTO_BUCKET = "profile-photos";
/** How long a shown photo's link lasts. The app signs a new one each time it loads the photo. */
export const PHOTO_LINK_SECONDS = 3600;

/** A new file's key: the student's own folder (the bucket allows no other), named by the moment it was made. */
export function newPhotoPath(userId: string, now: number = Date.now()): string {
  return `${userId}/${now}.jpg`;
}

/** The server's own sentence when it sent one (DETAIL), else ours. */
function refusal(error: unknown, fallback: string): Error {
  const details = (error as { details?: unknown } | null)?.details;
  return new Error(typeof details === "string" && details.trim() ? details.trim() : toErrorMessage(error, fallback));
}

export async function readPhotoPath(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from("profiles").select("photo_url").eq("id", userId).maybeSingle();
  if (error) throw refusal(error, "Could not read your photo");
  return data?.photo_url ?? null;
}

export async function signPhoto(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).createSignedUrl(path, PHOTO_LINK_SECONDS);
  if (error || !data?.signedUrl) throw refusal(error, "Could not show your photo");
  return data.signedUrl;
}

/** The old file goes last and quietly: a profile showing the new photo matters, a leftover file does not. */
async function removeFile(path: string): Promise<void> {
  const { error } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove([path]);
  if (error) console.warn("[profile photo] an old photo file was left in the bucket", error);
}

/** Save a new photo, replacing `previous`. Returns the new file's key. */
export async function saveProfilePhoto(userId: string, photo: Blob, previous: string | null): Promise<string> {
  const path = newPhotoPath(userId);
  const uploaded = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .upload(path, photo, { contentType: "image/jpeg", upsert: false });
  if (uploaded.error) throw refusal(uploaded.error, "Could not upload your photo");
  const { error } = await supabase.rpc("rpc_set_profile_photo", { _path: path });
  if (error) {
    // The profile still names the old photo; the new file would be named by nothing.
    await removeFile(path);
    throw refusal(error, "Could not save your photo");
  }
  if (previous && previous !== path) await removeFile(previous);
  return path;
}

/** Back to the initials: the profile first, then the file. */
export async function removeProfilePhoto(path: string | null): Promise<void> {
  // _path left out: its SQL default, NULL, clears the photo.
  const { error } = await supabase.rpc("rpc_set_profile_photo", {});
  if (error) throw refusal(error, "Could not remove your photo");
  if (path) await removeFile(path);
}
