import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Phone, Send, CheckCircle2, RotateCcw, User, UserCheck } from 'lucide-react'
import BackButton from '../components/ui/BackButton'
import { useAuth } from '../lib/AuthContext'
import {
  type SekretariatChat,
  type SekretariatMessage,
  subscribeAllChats,
  subscribeMessages,
  sendStaffMessage,
  markReadByStaff,
  closeChat,
  reopenChat,
  acceptChat,
  releaseChat,
} from '../lib/firestoreSekretariatChat'

function formatTime(ts: SekretariatChat['lastMessageAt']): string {
  if (!ts) return ''
  const d = ts.toDate()
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatTimeFull(ts: SekretariatMessage['createdAt']): string {
  if (!ts) return '…'
  const d = ts.toDate()
  return d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function SekretariatChatPage() {
  const { profile, user } = useAuth()
  const [chats, setChats] = useState<SekretariatChat[]>([])
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SekretariatMessage[]>([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeAllChats(setChats), [])

  useEffect(() => {
    if (!selectedId) { setMessages([]); return }
    const unsub = subscribeMessages(selectedId, setMessages)
    markReadByStaff(selectedId).catch(() => {})
    return unsub
  }, [selectedId])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const filtered = useMemo(() => {
    if (filter === 'all') return chats
    return chats.filter(c => c.status === filter)
  }, [chats, filter])

  const selected = chats.find(c => c.id === selectedId) ?? null

  async function handleSend() {
    if (!selected || !text.trim() || !profile) return
    setSending(true)
    try {
      await sendStaffMessage(selected.id, text.trim(), profile.displayName)
      setText('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      <BackButton />
      <div className="flex items-center gap-3 mb-1">
        <MessageSquare className="w-6 h-6 text-primary-600" />
        <h1 className="text-2xl font-bold text-gray-900">Web-Chat – Besucher der Website</h1>
      </div>
      <p className="text-sm text-gray-500 mb-4 ml-9">
        Anfragen externer Besucher von augenzentrum-suhr.ch. <strong>Kein interner Mitarbeiter-Chat.</strong>
      </p>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex h-[calc(100vh-200px)]">
        {/* Sidebar: conversation list */}
        <aside className="w-80 border-r border-gray-200 flex flex-col">
          <div className="p-3 border-b border-gray-200 flex gap-1">
            {(['open', 'closed', 'all'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={
                  'flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ' +
                  (filter === f
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-500 hover:bg-gray-100')
                }
              >
                {f === 'open' ? 'Offen' : f === 'closed' ? 'Geschlossen' : 'Alle'}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-sm text-gray-400">
                Keine Konversationen.
              </div>
            ) : filtered.map(c => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={
                  'w-full text-left px-3 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ' +
                  (selectedId === c.id ? 'bg-primary-50/50' : '')
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="font-medium text-sm text-gray-900 truncate">
                      {c.visitorName || 'Anonym'}
                    </span>
                    {c.unreadByStaff && (
                      <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                    )}
                  </div>
                  <span className="text-[10px] text-gray-400 shrink-0">
                    {formatTime(c.lastMessageAt)}
                  </span>
                </div>
                {c.visitorPhone && (
                  <div className="text-[11px] text-gray-500 mt-0.5 ml-6 flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {c.visitorPhone}
                  </div>
                )}
                <div className="text-xs text-gray-500 mt-1 ml-6 truncate">
                  {c.lastMessagePreview || '(keine Nachricht)'}
                </div>
                {c.status === 'closed' ? (
                  <div className="text-[10px] text-gray-400 mt-1 ml-6">geschlossen</div>
                ) : c.assignedToName ? (
                  <div className="text-[10px] text-emerald-600 mt-1 ml-6 flex items-center gap-1">
                    <UserCheck className="w-3 h-3" /> {c.assignedToName}
                  </div>
                ) : (
                  <div className="text-[10px] text-orange-600 mt-1 ml-6 font-medium">
                    ⏳ wartet
                  </div>
                )}
              </button>
            ))}
          </div>
        </aside>

        {/* Chat area */}
        <section className="flex-1 flex flex-col">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
              Konversation auswählen
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900">{selected.visitorName || 'Anonym'}</div>
                  {selected.visitorPhone && (
                    <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                      <Phone className="w-3 h-3" /> {selected.visitorPhone}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 items-center">
                  {selected.status === 'open' && !selected.assignedToUid && (
                    <button
                      onClick={() => user && profile && acceptChat(selected.id, user.uid, profile.displayName)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5"
                    >
                      <UserCheck className="w-3.5 h-3.5" /> Übernehmen
                    </button>
                  )}
                  {selected.assignedToUid && selected.assignedToUid === user?.uid && (
                    <button
                      onClick={() => releaseChat(selected.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-1.5"
                    >
                      Freigeben
                    </button>
                  )}
                  {selected.assignedToUid && selected.assignedToUid !== user?.uid && (
                    <span className="text-xs px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5" /> {selected.assignedToName}
                    </span>
                  )}
                  {selected.status === 'open' ? (
                    <button
                      onClick={() => closeChat(selected.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Schliessen
                    </button>
                  ) : (
                    <button
                      onClick={() => reopenChat(selected.id)}
                      className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Wieder öffnen
                    </button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
                {messages.map(m => (
                  <div
                    key={m.id}
                    className={'flex ' + (m.sender === 'staff' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={
                        'max-w-[70%] rounded-2xl px-4 py-2 shadow-sm ' +
                        (m.sender === 'staff'
                          ? 'bg-primary-600 text-white'
                          : 'bg-white text-gray-900 border border-gray-200')
                      }
                    >
                      <div className="text-sm whitespace-pre-wrap break-words">{m.text}</div>
                      <div
                        className={
                          'text-[10px] mt-1 ' +
                          (m.sender === 'staff' ? 'text-primary-100' : 'text-gray-400')
                        }
                      >
                        {m.sender === 'staff' && m.staffName ? m.staffName + ' · ' : ''}
                        {formatTimeFull(m.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && (
                  <div className="text-center text-xs text-gray-400 py-8">
                    Noch keine Nachrichten.
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="p-3 border-t border-gray-200 bg-white">
                <div className="flex gap-2">
                  <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    placeholder="Antwort schreiben… (Enter = senden, Shift+Enter = neue Zeile)"
                    rows={2}
                    className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    disabled={sending || selected.status === 'closed'}
                  />
                  <button
                    onClick={handleSend}
                    disabled={!text.trim() || sending || selected.status === 'closed'}
                    className="px-4 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center gap-1.5 self-stretch"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                {selected.status === 'closed' && (
                  <div className="text-[11px] text-gray-400 mt-1.5">
                    Konversation ist geschlossen. Zum Antworten zuerst „Wieder öffnen".
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
