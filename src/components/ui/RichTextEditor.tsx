import { useRef, useState, useCallback } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import {
  Bold, Italic, UnderlineIcon, List, ListOrdered,
  Heading2, Heading3, AlignLeft, AlignCenter, AlignRight,
  Undo2, Redo2, Minus, ImageIcon, Link2, Link2Off, X, Check, Loader2, GitBranch,
} from 'lucide-react'
import { MermaidBlock } from './MermaidBlock'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../lib/firebase'

interface Props {
  content: string
  onChange?: (html: string) => void
  editable?: boolean
  placeholder?: string
  className?: string
}

/** Compress image file and upload to Firebase Storage; returns public download URL */
async function uploadImage(file: File): Promise<string> {
  // 1. Compress to JPEG canvas (max 1400 px wide, q=0.85)
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const img = new window.Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const MAX = 1400
      let w = img.naturalWidth, h = img.naturalHeight
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden')) }
    img.src = url
  })
  // 2. Convert base64 → Blob
  const res  = await fetch(dataUrl)
  const blob = await res.blob()
  // 3. Upload to Firebase Storage
  const id   = crypto.randomUUID()
  const sRef = storageRef(storage, `onboarding-images/${id}.jpg`)
  await uploadBytes(sRef, blob, { contentType: 'image/jpeg' })
  // 4. Return permanent download URL
  return getDownloadURL(sRef)
}

function ToolbarBtn({
  onClick, active, disabled, title, children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-primary-100 text-primary-700'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      } disabled:opacity-30 disabled:cursor-default`}
    >
      {children}
    </button>
  )
}

function Toolbar({
  editor,
  onImageBtnClick, showImageInput, imageUrl, setImageUrl, onImageConfirm, onImageCancel,
  onLinkBtnClick, showLinkInput, linkUrl, setLinkUrl, onLinkConfirm, onLinkCancel,
}: {
  editor: Editor
  onImageBtnClick: () => void
  showImageInput: boolean
  imageUrl: string
  setImageUrl: (v: string) => void
  onImageConfirm: () => void
  onImageCancel: () => void
  onLinkBtnClick: () => void
  showLinkInput: boolean
  linkUrl: string
  setLinkUrl: (v: string) => void
  onLinkConfirm: () => void
  onLinkCancel: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-gray-200 bg-gray-50 rounded-t-lg">
      {/* Undo / Redo */}
      <ToolbarBtn title="Rückgängig" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        <Undo2 className="w-4 h-4" />
      </ToolbarBtn>
      <ToolbarBtn title="Wiederholen" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        <Redo2 className="w-4 h-4" />
      </ToolbarBtn>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Headings */}
      <ToolbarBtn title="Überschrift 2" active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="w-4 h-4" />
      </ToolbarBtn>
      <ToolbarBtn title="Überschrift 3" active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="w-4 h-4" />
      </ToolbarBtn>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Inline formatting */}
      <ToolbarBtn title="Fett" active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="w-4 h-4" />
      </ToolbarBtn>
      <ToolbarBtn title="Kursiv" active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="w-4 h-4" />
      </ToolbarBtn>
      <ToolbarBtn title="Unterstrichen" active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="w-4 h-4" />
      </ToolbarBtn>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Lists */}
      <ToolbarBtn title="Aufzählung" active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="w-4 h-4" />
      </ToolbarBtn>
      <ToolbarBtn title="Nummerierte Liste" active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="w-4 h-4" />
      </ToolbarBtn>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Alignment */}
      <ToolbarBtn title="Links" active={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        <AlignLeft className="w-4 h-4" />
      </ToolbarBtn>
      <ToolbarBtn title="Zentriert" active={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        <AlignCenter className="w-4 h-4" />
      </ToolbarBtn>
      <ToolbarBtn title="Rechts" active={editor.isActive({ textAlign: 'right' })}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        <AlignRight className="w-4 h-4" />
      </ToolbarBtn>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Horizontal rule */}
      <ToolbarBtn title="Trennlinie" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className="w-4 h-4" />
      </ToolbarBtn>

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Link */}
      {showLinkInput ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="text"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onLinkConfirm(); if (e.key === 'Escape') onLinkCancel() }}
            placeholder="https://…"
            className="text-xs border border-gray-300 rounded px-2 py-1 w-56 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
          <button type="button" onClick={onLinkConfirm} className="p-1 text-green-600 hover:text-green-700"><Check className="w-4 h-4" /></button>
          <button type="button" onClick={onLinkCancel} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
      ) : editor.isActive('link') ? (
        <>
          <ToolbarBtn title="Link bearbeiten" active onClick={onLinkBtnClick}>
            <Link2 className="w-4 h-4" />
          </ToolbarBtn>
          <ToolbarBtn title="Link entfernen" onClick={() => editor.chain().focus().unsetLink().run()}>
            <Link2Off className="w-4 h-4" />
          </ToolbarBtn>
        </>
      ) : (
        <ToolbarBtn title="Link einfügen" onClick={onLinkBtnClick}>
          <Link2 className="w-4 h-4" />
        </ToolbarBtn>
      )}

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Image */}
      {showImageInput ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            type="text"
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') onImageConfirm(); if (e.key === 'Escape') onImageCancel() }}
            placeholder="https://… oder Bild einfügen (Ctrl+V)"
            className="text-xs border border-gray-300 rounded px-2 py-1 w-64 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
          <button type="button" onClick={onImageConfirm} className="p-1 text-green-600 hover:text-green-700"><Check className="w-4 h-4" /></button>
          <button type="button" onClick={onImageCancel} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
      ) : (
        <ToolbarBtn title="Bild einfügen (URL oder Strg+V)" onClick={onImageBtnClick}>
          <ImageIcon className="w-4 h-4" />
        </ToolbarBtn>
      )}

      <div className="w-px h-5 bg-gray-300 mx-1" />

      {/* Mermaid flowchart */}
      <ToolbarBtn title="Flussdiagramm einfügen"
        onClick={() => (editor.chain().focus() as any).insertMermaidBlock().run()}>
        <GitBranch className="w-4 h-4" />
      </ToolbarBtn>
    </div>
  )
}

export default function RichTextEditor({ content, onChange, editable = true, placeholder, className }: Props) {
  const [showImageInput, setShowImageInput] = useState(false)
  const [imageUrl,       setImageUrl]       = useState('')
  const [uploading,      setUploading]      = useState(false)
  const [showLinkInput,  setShowLinkInput]  = useState(false)
  const [linkUrl,        setLinkUrl]        = useState('')

  const insertImage = useCallback((src: string) => {
    if (!src.trim()) return
    editorRef.current?.chain().focus().setImage({ src: src.trim() }).run()
  }, [])

  const handleFileUpload = useCallback(async (file: File) => {
    setUploading(true)
    try {
      const url = await uploadImage(file)
      editorRef.current?.chain().focus().setImage({ src: url }).run()
    } catch {
      alert('Bild konnte nicht hochgeladen werden.')
    } finally {
      setUploading(false)
    }
  }, [])

  const handleImageConfirm = () => {
    insertImage(imageUrl)
    setImageUrl('')
    setShowImageInput(false)
  }

  const handleImageCancel = () => {
    setImageUrl('')
    setShowImageInput(false)
  }

  const handleLinkBtnClick = () => {
    const existing = editorRef.current?.getAttributes('link').href ?? ''
    setLinkUrl(existing)
    setShowLinkInput(true)
    setShowImageInput(false)
  }

  const handleLinkConfirm = () => {
    const url = linkUrl.trim()
    if (!url) {
      editorRef.current?.chain().focus().unsetLink().run()
    } else {
      const href = url.startsWith('http') ? url : `https://${url}`
      editorRef.current?.chain().focus().setLink({ href, target: '_blank' }).run()
    }
    setLinkUrl('')
    setShowLinkInput(false)
  }

  const handleLinkCancel = () => {
    setLinkUrl('')
    setShowLinkInput(false)
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: placeholder ?? 'Text eingeben…' }),
      Image.configure({
        inline: false,
        HTMLAttributes: { class: 'max-w-full rounded-lg my-3' },
      }),
      Link.configure({
        openOnClick: !editable,
        HTMLAttributes: {
          class: 'text-primary-600 underline underline-offset-2 hover:text-primary-800 cursor-pointer',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      MermaidBlock,
    ],
    content,
    editable,
    editorProps: {
      handlePaste(_, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of Array.from(items)) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (!file) continue
            handleFileUpload(file)
            return true
          }
        }
        return false
      },
      handleDrop(_, event) {
        const files = event.dataTransfer?.files
        if (!files?.length) return false
        const file = files[0]
        if (!file.type.startsWith('image/')) return false
        handleFileUpload(file)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML())
    },
  })

  // Keep a ref for use inside callbacks
  const editorRef = useRef(editor)
  editorRef.current = editor

  if (!editor) return null

  return (
    <div className={`flex flex-col overflow-hidden ${className ?? ''}`}>
      {editable && (
        <Toolbar
          editor={editor}
          onImageBtnClick={() => { setShowImageInput(true); setShowLinkInput(false) }}
          showImageInput={showImageInput}
          imageUrl={imageUrl}
          setImageUrl={setImageUrl}
          onImageConfirm={handleImageConfirm}
          onImageCancel={handleImageCancel}
          onLinkBtnClick={handleLinkBtnClick}
          showLinkInput={showLinkInput}
          linkUrl={linkUrl}
          setLinkUrl={setLinkUrl}
          onLinkConfirm={handleLinkConfirm}
          onLinkCancel={handleLinkCancel}
        />
      )}
      <div className="relative flex-1 overflow-y-auto">
        {uploading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
            <div className="flex items-center gap-2 text-sm text-primary-600 font-medium bg-white border border-primary-200 rounded-xl px-4 py-2 shadow">
              <Loader2 className="w-4 h-4 animate-spin" /> Bild wird hochgeladen…
            </div>
          </div>
        )}
        <EditorContent
          editor={editor}
          className="prose prose-sm max-w-none focus:outline-none px-8 py-6 min-h-full"
        />
      </div>
    </div>
  )
}
