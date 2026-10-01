import React, { useState } from 'react'
import Layout from '../components/Layout'
import Modal from '../components/Modal'
import FormInput from '../components/FormInput'
import { usersApi } from '../storage'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

function useUsers(){ return useQuery(['users'], usersApi.list) }

export default function UsersPage(){
  const qc = useQueryClient()
  const { data, isLoading } = useUsers()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ username:'', displayName:'', email:'' })

  const createM = useMutation(usersApi.create, { onSuccess: ()=>{ qc.invalidateQueries(['users']); setOpen(false); setForm({username:'',displayName:'',email:''}) }})
  const updateM = useMutation(({id,patch})=>usersApi.update(id,patch), { onSuccess: ()=>{ qc.invalidateQueries(['users']); setOpen(false); setEditing(null); setForm({username:'',displayName:'',email:''}) }})
  const deleteM = useMutation(usersApi.delete, { onSuccess: ()=> qc.invalidateQueries(['users']) })

  function startEdit(u){ setEditing(u); setForm({ username: u.username, displayName: u.displayName, email: u.email }); setOpen(true) }

  return (
    <Layout>
      <div className='flex items-center justify-between mb-4'>
        <h1 className='text-2xl font-bold'>Users</h1>
        <div>
          <button onClick={()=>{ setForm({username:'',displayName:'',email:''}); setEditing(null); setOpen(true) }} className='px-3 py-2 bg-indigo-600 text-white rounded'>Add User</button>
        </div>
      </div>

      <div className='space-y-2'>
        {isLoading && <div className='p-4 bg-white rounded shadow-sm'>Loading…</div>}
        {!isLoading && (data||[]).map(u=>(
          <div key={u.id} className='p-3 bg-white rounded shadow-sm flex justify-between items-center'>
            <div>
              <div className='font-medium'>{u.displayName || u.username}</div>
              <div className='text-xs text-gray-500'>{u.email}</div>
            </div>
            <div className='flex items-center gap-2'>
              <button onClick={()=>startEdit(u)} className='px-3 py-1 border rounded text-sm'>Edit</button>
              <button onClick={()=>{ if(confirm('Delete user?')) deleteM.mutate(u.id) }} className='px-3 py-1 rounded text-sm bg-red-50 text-red-700'>Delete</button>
            </div>
          </div>
        ))}
        {(data||[]).length===0 && <div className='p-4 bg-white rounded shadow-sm text-gray-500'>No users yet. Add one!</div>}
      </div>

      <Modal open={open} title={editing ? 'Edit user' : 'Add user'} onClose={()=>setOpen(false)}>
        <div className='space-y-3'>
          <FormInput label='Username' value={form.username} onChange={v=>setForm(s=>({...s,username:v}))} />
          <FormInput label='Display name' value={form.displayName} onChange={v=>setForm(s=>({...s,displayName:v}))} />
          <FormInput label='Email' value={form.email} onChange={v=>setForm(s=>({...s,email:v}))} />
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
