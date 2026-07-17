// @vitest-environment jsdom
// Skipped until the mobile test harness includes these tests and their DOM dependencies.
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { WorkerScreen } from './WorkerScreen'
import { MockFleetSource } from '../data/MockFleetSource'

describe.skip('WorkerScreen', () => {
  it('shows the snapshot and sends typed text', async () => {
    const source = new MockFleetSource()
    render(<WorkerScreen source={source} workerId="w-alpha" onBack={() => {}} />)
    await waitFor(() => expect(screen.getByRole('textbox')).toBeInTheDocument())
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ship it' } })
    fireEvent.click(screen.getByText('Send'))
    await waitFor(async () => {
      expect(await source.readOutput('w-alpha')).toContain('ship it')
    })
  })
})
