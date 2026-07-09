'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useI18n } from '@/contexts/i18n-context';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

function ErrorBoundaryUI({
  error,
  errorInfo,
  onRetry,
  onReload,
}: {
  error?: Error;
  errorInfo?: ErrorInfo;
  onRetry: () => void;
  onReload: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <CardTitle className="text-red-900">{t('errorBoundary.title')}</CardTitle>
          <CardDescription>
            {t('errorBoundary.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {process.env.NODE_ENV === 'development' && error && (
            <div className="rounded-md bg-red-50 p-3">
              <h4 className="text-sm font-medium text-red-800 mb-2">
                {t('errorBoundary.errorDetails')}
              </h4>
              <pre className="text-xs text-red-700 whitespace-pre-wrap break-all">
                {error.message}
              </pre>
              {errorInfo && (
                <details className="mt-2">
                  <summary className="text-xs text-red-600 cursor-pointer">
                    {t('errorBoundary.componentStack')}
                  </summary>
                  <pre className="text-xs text-red-600 mt-1 whitespace-pre-wrap">
                    {errorInfo.componentStack}
                  </pre>
                </details>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Button onClick={onRetry} variant="outline" className="w-full">
              <RefreshCw className="h-4 w-4 mr-2" />
              {t('errorBoundary.retry')}
            </Button>
            <Button onClick={onReload} className="w-full">
              {t('errorBoundary.reload')}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground text-center">
            {t('errorBoundary.persistHint')}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);

    this.setState({
      error,
      errorInfo
    });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorBoundaryUI
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onRetry={this.handleRetry}
          onReload={this.handleReload}
        />
      );
    }

    return this.props.children;
  }
}

// Hook version for functional components
export function useErrorHandler() {
  return (error: Error, errorInfo?: ErrorInfo) => {
    console.error('Error caught by useErrorHandler:', error, errorInfo);
  };
}
