import React from 'react'
export default function Modal({ open, title, onClose, children }){
  if (!open) return null
  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center'>
      <div className='absolute inset-0 bg-black/40'></div>
      <div className='relative bg-white rounded-lg shadow-lg w-full max-w-xl p-6 z-10'>
        <div className='flex justify-between items-center mb-4'>
          <h3 className='text-lg font-semibold'>{title}</h3>
          <button onClick={onClose} className='text-gray-500'>Close</button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  )
}
