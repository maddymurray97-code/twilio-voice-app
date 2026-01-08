import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;

export async function GET(req: NextRequest) {
  try {
    console.log('🔄 Starting calendar sync...');
    
    // Get all businesses with Microsoft calendar enabled
    const businesses = await getBusinessesWithMicrosoftCalendar();
    console.log(`Found ${businesses.length} businesses to sync`);
    
    for (const business of businesses) {
      console.log(`Syncing ${business.name}...`);
      
      // Check if token expired
      if (isTokenExpired(business.tokenExpiry)) {
        console.log('Token expired, refreshing...');
        await refreshMicrosoftToken(business);
      }
      
      // Fetch calendar events
      const events = await fetchMicrosoftCalendarEvents(business);
      console.log(`Found ${events.length} events`);
      
      // Create appointments in Airtable
      for (const event of events) {
        await createOrUpdateAppointment(business, event);
      }
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `Synced ${businesses.length} calendars` 
    });
    
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ 
      error: 'Sync failed', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

async function getBusinessesWithMicrosoftCalendar() {
  const formula = `AND({Calendar Type} = 'Microsoft 365', {Calendar Sync Enabled} = TRUE())`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Businesses?filterByFormula=${encodeURIComponent(formula)}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
  });
  
  const data = await response.json();
  return data.records.map((r: any) => ({
    id: r.id,
    name: r.fields['Business Name'],
    accessToken: r.fields['Microsoft Access Token'],
    refreshToken: r.fields['Microsoft Refresh Token'],
    tokenExpiry: r.fields['Microsoft Token Expiry'],
    email: r.fields['Calendar Email']
  }));
}

function isTokenExpired(expiryDate: string): boolean {
  if (!expiryDate) return true;
  return new Date(expiryDate) <= new Date();
}

async function refreshMicrosoftToken(business: any) {
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID!,
      client_secret: MICROSOFT_CLIENT_SECRET!,
      refresh_token: business.refreshToken,
      grant_type: 'refresh_token',
      scope: 'https://graph.microsoft.com/Calendars.Read offline_access'
    })
  });
  
  const tokens = await response.json();
  const expiryDate = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  
  await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Businesses/${business.id}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Microsoft Access Token': tokens.access_token,
          'Microsoft Refresh Token': tokens.refresh_token,
          'Microsoft Token Expiry': expiryDate
        }
      })
    }
  );
  
  business.accessToken = tokens.access_token;
  console.log('✅ Refreshed Microsoft token');
}

async function fetchMicrosoftCalendarEvents(business: any) {
  const now = new Date();
  const twoWeeksLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  
  const url = `https://graph.microsoft.com/v1.0/me/calendar/events?` +
    `$filter=start/dateTime ge '${now.toISOString()}' and start/dateTime le '${twoWeeksLater.toISOString()}'&` +
    `$orderby=start/dateTime`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${business.accessToken}`,
      'Content-Type': 'application/json'
    }
  });
  
  if (!response.ok) {
    console.error('Failed to fetch events:', await response.text());
    return [];
  }
  
  const data = await response.json();
  return data.value || [];
}

async function createOrUpdateAppointment(business: any, event: any) {
  // Check if appointment already exists
  const existingApt = await findAppointmentByEventId(event.id);
  
  const appointmentData = {
    'Business Name': [business.id],
    'Customer Name': event.attendees?.[0]?.emailAddress?.name || event.subject || 'Unknown',
    'Customer Email': event.attendees?.[0]?.emailAddress?.address || '',
    'Customer Phone': extractPhoneFromEvent(event),
    'Appointment Date': event.start.dateTime.split('T')[0],
    'Appointment Time': formatTime(event.start.dateTime),
    'Service/Meeting Title': event.subject || 'Meeting',
    'Microsoft Event ID': event.id,
    'Status': 'Scheduled'
  };
  
  if (existingApt) {
    // Update existing
    await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Appointments/${existingApt.id}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: appointmentData })
      }
    );
    console.log(`✅ Updated appointment: ${appointmentData['Service/Meeting Title']}`);
  } else {
    // Create new
    await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Appointments`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: appointmentData })
      }
    );
    console.log(`✅ Created appointment: ${appointmentData['Service/Meeting Title']}`);
  }
}

async function findAppointmentByEventId(eventId: string) {
  const formula = `{Microsoft Event ID} = '${eventId}'`;
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Appointments?filterByFormula=${encodeURIComponent(formula)}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
  });
  
  const data = await response.json();
  return data.records[0];
}

function extractPhoneFromEvent(event: any): string {
  // Try to extract phone from body or attendee info
  const body = event.body?.content || '';
  const phoneRegex = /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
  const match = body.match(phoneRegex);
  return match ? match[0] : '';
}

function formatTime(dateTimeString: string): string {
  const date = new Date(dateTimeString);
  return date.toLocaleTimeString('en-US', { 
    hour: 'numeric', 
    minute: '2-digit',
    hour12: true 
  });
}
