import React from 'react'

interface Props {
  children: React.ReactNode
  label?: string
}
interface State {
  error: Error | null
}

/**
 * Contains a render/mount crash to one panel instead of taking down the whole window.
 * (e.g. one panel's third-party dependency failing must never blank the app.)
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[ErrorBoundary]', this.props.label ?? '', error)
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="panel-error">
          <div className="panel-error-title">{this.props.label ?? 'This panel'} hit an error</div>
          <div className="panel-error-msg">{this.state.error.message}</div>
          <button onClick={() => this.setState({ error: null })}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}
