import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

export async function GET(req: NextRequest) {
  try {
    console.log('📅 Starting calendar sync...');
    
    const businesses = await getBusinessesWithCalendarSync();
    console.log(`Found ${businesses.length} businesses with calendar sync enabled`);
    
    let totalSynced = 0;
    
    for (const business of businesses) {
      console.log(`\n🔄 Syncing calendar for: ${business.fields['Business Name']}`);
      
      if (business.fields['Calendar Type'] === 'Google Calendar') {
        const synced = await syncGoogleCalendar(business);
        totalSynced += synced;
      }
    }
    
    return NextResponse.json({
      success: true,
      message: `Synced ${totalSynced} appointments from ${businesses.length} calendars`
    });
    
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json({ 
      error: 'Sync failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

async function getBusinessesWithCalendarSync() {
  const formula = `AND(
    {Calendar Sync Enabled} = TRUE(),
    NOT({Google Access Token} = '')
  )`;
  
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Businesses?filterByFormula=${encodeURIComponent(formula)}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
  });
  
  const data = await response.json();
  return data.records || [];
}

async function syncGoogleCalendar(business: any): Promise<number> {
  const fields = business.fields;
  let accessToken = fields['Google Access Token'];
  
  // Check if token is expired and refresh if needed
  const tokenExpiry = fields['Google Token Expiry'];
  if (tokenExpiry && new Date(tokenExpiry) < new Date()) {
    console.log('🔄 Access token expired, refreshing...');
    accessToken = await refreshGoogleToken(business);
    if (!accessToken) {
      console.error('❌ Failed to refresh token');
      return 0;
    }
  }
  
  // Get events from Google Calendar for next 30 days
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  
  const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `timeMin=${now.toISOString()}&` +
    `timeMax=${thirtyDaysFromNow.toISOString()}&` +
    `singleEvents=true&` +
    `orderBy=startTime`;
  
  console.log('📡 Fetching Google Calendar events...');
  
  const response = await fetch(calendarUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  
  if (!response.ok) {
    console.error('❌ Google Calendar API error:', response.status);
    const errorData = await response.json();
    console.error('Error details:', errorData);
    return 0;
  }
  
  const calendarData = await response.json();
  const events = calendarData.items || [];
  
  console.log(`📋 Found ${events.length} calendar events`);
  
  let syncedCount = 0;
  
  for (const event of events) {
    // Skip events without attendees or that are all-day events
    if (!event.attendees || !event.start?.dateTime) {
      continue;
    }
    
    // Get the first attendee as the customer
    const attendee = event.attendees[0];
    const customerEmail = attendee.email;
    
    // Parse date and time
    const startDateTime = new Date(event.start.dateTime);
    const appointmentDate = `${startDateTime.getMonth() + 1}/${startDateTime.getDate()}/${startDateTime.getFullYear()}`;
    const appointmentTime = startDateTime.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });
    
    // Check if appointment already exists
    const exists = await checkAppointmentExists(
      business.id,
      customerEmail,
      appointmentDate,
      appointmentTime
    );
    
    if (exists) {
      console.log(`⏭️  Skipping existing appointment: ${event.summary}`);
      continue;
    }
    
    // Extract customer name from attendee
    const customerName = attendee.displayName || customerEmail.split('@')[0];
    
    // Create appointment in Airtable
    await createAppointment({
      businessId: business.id,
      customerName: customerName,
      customerEmail: customerEmail,
      appointmentDate: appointmentDate,
      appointmentTime: appointmentTime,
      service: event.summary || 'Appointment',
      googleEventId: event.id
    });
    
    console.log(`✅ Synced: ${event.summary} - ${appointmentDate} ${appointmentTime}`);
    syncedCount++;
  }
  
  return syncedCount;
}

async function refreshGoogleToken(business: any): Promise<string | null> {
  const refreshToken = business.fields['Google Refresh Token'];
  
  if (!refreshToken) {
    console.error('❌ No refresh token available');
    return null;
  }
  
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });
    
    const tokens = await response.json();
    
    if (tokens.error) {
      console.error('Token refresh error:', tokens);
      return null;
    }
    
    // Update access token in Airtable
    const expiryDate = new Date(Date.now() + tokens.expires_in * 1000).toISOString().split('T')[0];
    
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
            'Google Access Token': tokens.access_token,
            'Google Token Expiry': expiryDate
          }
        })
      }
    );
    
    console.log('✅ Token refreshed successfully');
    return tokens.access_token;
    
  } catch (error) {
    console.error('❌ Token refresh failed:', error);
    return null;
  }
}

async function checkAppointmentExists(
  businessId: string,
  customerEmail: string,
  appointmentDate: string,
  appointmentTime: string
): Promise<boolean> {
  const formula = `AND(
    {Business Name} = '${businessId}',
    {Customer Email} = '${customerEmail}',
    {Appointment Date} = '${appointmentDate}',
    {Appointment Time} = '${appointmentTime}'
  )`;
  
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Appointments?filterByFormula=${encodeURIComponent(formula)}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
  });
  
  const data = await response.json();
  return (data.records?.length || 0) > 0;
}

async function createAppointment(data: {
  businessId: string;
  customerName: string;
  customerEmail: string;
  appointmentDate: string;
  appointmentTime: string;
  service: string;
  googleEventId: string;
}) {
  await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Appointments`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Business Name': [data.businessId],
          'Customer Name': data.customerName,
          'Customer Email': data.customerEmail,
          'Appointment Date': data.appointmentDate,
          'Appointment Time': data.appointmentTime,
          'Service/Meeting Title': data.service,
          'Status': 'Scheduled',
          'Google Event ID': data.googleEventId
        }
      })
    }
  );
}
