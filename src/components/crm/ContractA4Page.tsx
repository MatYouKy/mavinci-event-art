'use client';

import React from 'react';

export interface ContractA4PageProps {
  children: React.ReactNode;
  showHeaderLogo?: boolean;
  headerLogoUrl?: string;
  headerLogoHeight?: number;
  headerLogoAlign?: 'left' | 'center' | 'right';
  showCenterLogo?: boolean;
  centerLogoUrl?: string;
  centerLogoHeight?: number;
  showFooter?: boolean;
  footerContent?: string;
  className?: string;
}

export const ContractA4Page: React.FC<ContractA4PageProps> = ({
  children,
  showHeaderLogo,
  headerLogoUrl,
  headerLogoHeight = 50,
  headerLogoAlign = 'left',
  showCenterLogo,
  centerLogoUrl,
  centerLogoHeight = 100,
  showFooter,
  footerContent,
  className = '',
}) => {
  const headerLogoJustify = {
    left: 'flex-start',
    center: 'center',
    right: 'flex-end',
  }[headerLogoAlign];

  return (
    <div className={`contract-a4-page ${className}`}>
      {showHeaderLogo && headerLogoUrl && (
        <div
          className="contract-header-logo"
          style={{
            justifyContent: headerLogoJustify,
          }}
        >
          <img
            src={headerLogoUrl}
            alt="Logo"
            style={{ height: `${headerLogoHeight}px` }}
            className="object-contain"
          />
        </div>
      )}

      {showCenterLogo && centerLogoUrl && (
        <div className="contract-center-logo">
          <img
            src={centerLogoUrl}
            alt="Logo"
            style={{ height: `${centerLogoHeight}px` }}
            className="object-contain mx-auto"
          />
        </div>
      )}

      <div className="contract-content">{children}</div>

      {showFooter && footerContent && (
        <div
          className="contract-footer"
          dangerouslySetInnerHTML={{ __html: footerContent }}
        />
      )}

      <style jsx global>{`
        .contract-a4-page {
          position: relative;
          width: 210mm;
          height: 297mm;
          margin: 0 auto 20px auto;
          padding: 20mm 25mm 30mm;
          background: white;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
          font-family: Arial, sans-serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #000;
          page-break-after: always;
          break-after: page;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
        }

        .contract-header-logo {
          width: 100%;
          display: flex;
          align-items: center;
          margin-bottom: 4mm;
          flex-shrink: 0;
        }

        .contract-center-logo {
          width: 100%;
          text-align: center;
          margin-bottom: 8mm;
          flex-shrink: 0;
        }

        .contract-content {
          flex: 1;
          overflow: visible;
        }

        .contract-footer {
          margin-top: auto;
          padding-top: 5mm;
          border-top: 1px solid #d3bb73;
          text-align: center;
          font-size: 10pt;
          color: #666;
          flex-shrink: 0;
        }

        @media print {
          .contract-a4-page {
            width: 210mm;
            height: 297mm;
            margin: 0;
            padding: 20mm 25mm 30mm;
            box-shadow: none;
            page-break-after: always;
            break-after: page;
          }

          body {
            margin: 0;
            padding: 0;
          }
        }
      `}</style>
    </div>
  );
};

export const ContractA4Container: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <>
      <div className="contract-container">{children}</div>
      <style jsx global>{`
        .contract-container {
          background: #f5f5f5;
          padding: 20px;
          min-height: 100vh;
        }

        @media print {
          .contract-container {
            background: white;
            padding: 0;
          }
        }
      `}</style>
    </>
  );
};
