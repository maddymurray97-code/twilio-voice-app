import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

export async function GET(req: NextRequest) {
  try {
    const businessId = 'rec3PLLV3K06kMYCK';
    
    console.log('🧪 Testing Airtable update for:', businessId);
    
    const response = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Businesses/${businessId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            'Calendar Type': 'Google Calendar',
            'Calendar Email': 'test@example.com',
            'Calendar Sync Enabled': true
          }
        })
      }
    );
    
    const data = await response.json();
    
    return NextResponse.json({
      status: response.status,
      ok: response.ok,
      data: data
    });
    
  } catch (error) {
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : String(error) 
    }, { status: 500 });
  }
}
