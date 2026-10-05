/**
 * Browser-side avatar intake for Bot profiles: validate one picked file,
 * downscale it onto a square canvas, and encode the result as a PNG data URL
 * small enough to travel through the profile update Remote call.
 */

/** Longest source image accepted, in bytes; larger picks are rejected by name. */
export const AVATAR_SOURCE_MAX_BYTES = 5 * 1024 * 1024

/** Side length (px) of the square canvas every avatar is projected onto. */
export const AVATAR_SIDE = 192

/**
 * Decode one picked image file, project it onto a square transparent canvas
 * with its aspect ratio preserved, and encode the result as a PNG data URL.
 * @param file - The image file the user picked.
 * @returns the avatar data URL to store through the Bot update command.
 * @throws Error when the file is not an image, is too large, or cannot decode.
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('avatar: not an image file')
  if (file.size > AVATAR_SOURCE_MAX_BYTES) throw new Error('avatar: source image too large')
  const image = await decode(file)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIDE
  canvas.height = AVATAR_SIDE
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('avatar: canvas is unavailable')
  const scale = Math.min(AVATAR_SIDE / image.naturalWidth, AVATAR_SIDE / image.naturalHeight)
  const width = Math.max(1, Math.round(image.naturalWidth * scale))
  const height = Math.max(1, Math.round(image.naturalHeight * scale))
  context.drawImage(image, (AVATAR_SIDE - width) / 2, (AVATAR_SIDE - height) / 2, width, height)
  return canvas.toDataURL('image/png')
}

/** Decode one file into an image element through an object URL, released after load. */
function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => { resolve(image) }
    image.onerror = () => { reject(new Error('avatar: image could not be decoded')) }
    image.src = url
  }).finally(() => { URL.revokeObjectURL(url) })
}
