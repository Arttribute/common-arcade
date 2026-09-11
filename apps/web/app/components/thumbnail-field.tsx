'use client'
import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { GameArtwork } from './game-artwork'

export function ThumbnailField({
  value,
  onChange,
  disabled,
}: {
  value?: string
  onChange: (value: string | undefined) => void
  disabled?: boolean
}) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function upload(file: File) {
    setError('')
    setBusy(true)
    try {
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      )
        throw Error('Choose a PNG, JPEG or WebP image under 10 MB.')
      const bitmap = await createImageBitmap(file)
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      const context = canvas.getContext('2d')!
      const scale = Math.max(640 / bitmap.width, 360 / bitmap.height)
      context.drawImage(
        bitmap,
        (640 - bitmap.width * scale) / 2,
        (360 - bitmap.height * scale) / 2,
        bitmap.width * scale,
        bitmap.height * scale,
      )
      bitmap.close()
      let image = canvas.toDataURL('image/webp', 0.8)
      for (const quality of [0.65, 0.5, 0.35]) {
        if (image.length <= 90000) break
        image = canvas.toDataURL('image/webp', quality)
      }
      if (image.length > 90000)
        throw Error('This image is too detailed. Try a simpler crop.')
      onChange(image)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="studio-section thumbnail-field">
      <div className="studio-section-label">
        <ImagePlus size={14} /> Game thumbnail{' '}
        <span className="required-label">Required</span>
      </div>
      <GameArtwork title="Your game" src={value} />
      <label className="thumbnail-upload">
        {busy
          ? 'Preparing image…'
          : value
            ? 'Replace image'
            : 'Choose an image'}
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={disabled || busy}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void upload(file)
            e.target.value = ''
          }}
        />
      </label>
      <p className="studio-help">
        Shown on Discover and Live. Your image is cropped to 16:9 and saved with
        the game.
      </p>
      {value && (
        <button disabled={disabled} onClick={() => onChange(undefined)}>
          Remove image
        </button>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </section>
  )
}
