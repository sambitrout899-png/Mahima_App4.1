import React, { useState } from 'react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import FormInput from '../components/FormInput'
import { meetingsApi } from '../storage'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

function useMeetings(){ return useQuery(['meetings'], meetingsApi.list) }

export default function MeetingsPage(){
  const qc = useQueryClient()
  const { data, isLoading } = useMeetings()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ title:'', time:'', link:'' })

  const createM = useMutation(meetingsApi.create, { onSuccess: ()=>{ qc.invalidateQueries(['meetings']); setOpen(false); setForm({title:'',time:'',link:''}) }})
  const updateM = useMutation(({id,patch})=>meetingsApi.update(id,patch), { onSuccess: ()=>{ qc.invalidateQueries(['meetings']); setOpen(false); setEditing(null); setForm({title:'',time:'',link:''}) }})
  const deleteM = useMutation(meetingsApi.delete, { onSuccess: ()=> qc.invalidateQueries(['meetings']) })

  function startEdit(m){ setEditing(m); setForm({ title: m.title, time: m.time, link: m.link }); setOpen(true) }

  return (
    <Layout>
      <div className='flex items-center justify-between mb-4'>
        <h1 className='text-2xl font-bold'>Meetings</h1>
        <div>
          <button onClick={()=>{ setForm({title:'',time:'',link:''}); setEditing(null); setOpen(true) }} className='px-3 py-2 bg-indigo-600 text-white rounded'>Add Meeting</button>
        </div>
      </div>

      <div className='space-y-2'>
        {isLoading && <div className='p-4 bg-white rounded shadow-sm'>Loading…</div>}
        {!isLoading && (data||[]).map(m=>(
          <div key={m.id} className='p-3 bg-white rounded shadow-sm flex justify-between items-center'>
            <div>
              <div className='font-medium'>{m.title}</div>
              <div className='text-xs text-gray-500'>{m.time} • {m.link}</div>
            </div>
            <div className='flex items-center gap-2'>
              <button onClick={()=>startEdit(m)} className='px-3 py-1 border rounded text-sm'>Edit</button>
              <button onClick={()=>{ if(confirm('Delete meeting?')) deleteM.mutate(m.id) }} className='px-3 py-1 rounded text-sm bg-red-50 text-red-700'>Delete</button>
            </div>
          </div>
        ))}
        {(data||[]).length===0 && <div className='p-4 bg-white rounded shadow-sm text-gray-500'>No meetings yet. Add one!</div>}
      </div>

      <Modal open={open} title={editing ? 'Edit meeting' : 'Add meeting'} onClose={()=>setOpen(false)}>
        <div className='space-y-3'>
          <FormInput label='Title' value={form.title} onChange={v=>setForm(s=>({...s,title:v}))} />
          <FormInput label='Time' value={form.time} onChange={v=>setForm(s=>({...s,time:v}))} placeholder='2025-10-01 10:00' />
          <FormInput label='Link' value={form.link} onChange={v=>setForm(s=>({...s,link:v}))} />
          <div className='flex justify-end gap-2'>
            <button onClick={()=>setOpen(false)} className='px-3 py-2 border rounded'>Cancel</button>
            <button onClick={()=>{
              if (editing) updateM.mutate({ id: editing.id, patch: form })
              else createM.mutate(form)
            }} className='px-3 py-2 bg-indigo-600 text-white rounded'>{editing ? 'Save' : 'Create'}</button>
          </div>
        </div>
      </Modal>
    </Layout>
  )
}
