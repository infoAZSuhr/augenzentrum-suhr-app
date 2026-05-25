interface Props {
  columns: number
  rows?: number
}

export default function TableSkeleton({ columns, rows = 5 }: Props) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="animate-pulse">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-3 bg-gray-100 rounded" style={{ width: `${40 + ((r + c) * 13) % 50}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
