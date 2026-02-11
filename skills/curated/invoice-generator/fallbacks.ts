/**
 * @alfred/skill-invoice-generator - Fallback strategies
 */

export interface FallbackStrategy {
  name: string;
  description: string;
  trigger: string;
  action: () => Promise<void> | void;
}

export function getFallbacks(): FallbackStrategy[] {
  return [
    {
      name: 'plain-text-export',
      description: 'Export invoice as plain text when HTML generation fails',
      trigger: 'HTML template rendering error',
      action: () => {
        // Generate plain text invoice with ASCII table formatting
      },
    },
    {
      name: 'invoice-number-collision',
      description: 'Auto-increment invoice number when collision detected',
      trigger: 'Generated invoice number already exists',
      action: () => {
        // Built into generateInvoiceNumber — finds max existing number and increments
      },
    },
    {
      name: 'structured-input-prompt',
      description: 'Prompt for structured input when natural language parsing fails',
      trigger: 'Cannot parse invoice details from input',
      action: () => {
        // Return error with expected structure format
      },
    },
    {
      name: 'default-currency',
      description: 'Default to USD when currency is not specified',
      trigger: 'Currency field is undefined',
      action: () => {
        // Built into invoiceCreate — defaults to USD
      },
    },
  ];
}
