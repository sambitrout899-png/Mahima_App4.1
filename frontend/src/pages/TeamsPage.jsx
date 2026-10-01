import React, { useState } from 'react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import FormInput from '../components/FormInput'
import { teamsApi } from '../storage'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

function useTeams(){ return useQuery(['teams'], teamsApi.list) }

export default function TeamsPage(){
  const qc = useQueryClient()
  const { data, isLoading } = useTeams()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name:'', description:'' })

  const createM = useMutation(teamsApi.create, { onSuccess: ()=>{ qc.invalidateQueries(['teams']); setOpen(false); setForm({name:'',description:''}) }})
  const updateM = useMutation(({id,patch})=>teamsApi.update(id,patch), { onSuccess: ()=>{ qc.invalidateQueries(['teams']); setOpen(false); setEditing(null); setForm({name:'',description:''}) }})
  const deleteM = useMutation(teamsApi.delete, { onSuccess: ()=> qc.invalidateQueries(['teams']) })

  function startEdit(t){ setEditing(t); setForm({ name: t.name, description: t.description }); setOpen(true) }

  return (
    <Layout>
      <div className='flex items-center justify-between mb-4'>
        <h1 className='text-2xl font-bold'>Teams</h1>
        <div>
          <button onClick={()=>{ setForm({name:'',description:''}); setEditing(null); setOpen(true) }} className='px-3 py-2 bg-indigo-600 text-white rounded'>Add Team</button>
        </div>
      </div>

      <div className='space-y-2'>
        {isLoading && <div className='p-4 bg-white rounded shadow-sm'>Loading…</div>}
        {!isLoading && (data||[]).map(t=>(
          <div key={t.id} className='p-3 bg-white rounded shadow-sm flex justify-between items-center'>
            <div>
              <div className='font-medium'>{t.name}</div>
              <div className='text-xs text-gray-500'>{t.description}</div>
            </div>
            <div className='flex items-center gap-2'>
              <button onClick={()=>startEdit(t)} className='px-3 py-1 border rounded text-sm'>Edit</button>
              <button onClick={()=>{ if(confirm('Delete team?')) deleteM.mutate(t.id) }} className='px-3 py-1 rounded text-sm bg-red-50 text-red-700'>Delete</button>
            </div>
          </div>
        ))}
        {(data||[]).length===0 && <div className='p-4 bg-white rounded shadow-sm text-gray-500'>No teams yet. Add one!</div>}
      </div>

      <Modal open={open} title={editing ? 'Edit team' : 'Add team'} onClose={()=>setOpen(false)}>
        <div className='space-y-3'>
          <FormInput label='Team name' value={form.name} onChange={v=>setForm(s=>({...s,name:v}))} />
          <FormInput label='Description' value={form.description} onChange={v=>setForm(s=>({...s,description:v}))} />
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
