import React from 'react'
export default function Modal({ open, onClose, title, children }) {
  if (!open) return null
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <div className='absolute inset-0 bg-black/40'></div>
      <div className='relative z-10 bg-white rounded-lg shadow-xl w-full max-w-2xl p-6'>
        <div className='flex items-center justify-between mb-4'>
          <h3 className='text-lg font-semibold'>{title}</h3>
          <button onClick={onClose} className='text-gray-500'>Close</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  )
}
