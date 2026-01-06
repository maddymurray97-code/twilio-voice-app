import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Business directory';

export async function POST(req: NextRequest) {
  try {
    console.log('📞 Incoming call');
    
    const formData = await req.formData();
    const data = Object.fromEntries(formData);
    
    const calledNumber = data.To as string;
    const callerNumber = data.From as string;
    
    console.log(`Call from ${callerNumber} to ${calledNumber}`);
    
    // Look up business in Airtable
    const business = await getBusinessSettings(calledNumber);
    
    if (!business) {
      console.error('No business found for number:', calledNumber);
      const errorXml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">This number is not configured yet.</Say></Response>';
      return new NextResponse(errorXml, { 
        status: 200,
        headers: { 'Content-Type': 'text/xml' }
      });
    }
    
    // Send SMS to caller
    await sendSMS(callerNumber, business, calledNumber);
    
    // Notify business owner
    await notifyOwner(business, callerNumber);
    
    // Play message to caller
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Thanks for calling! We\'ve sent you a text message with information on how to book an appointment or get in touch.</Say><Hangup/></Response>';
    
    return new NextResponse(xml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
    
  } catch (error) {
    console.error('Error:', error);
    const errorXml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">An error occurred. Please try again later.</Say></Response>';
    return new NextResponse(errorXml, { 
      status: 200,
      headers: { 'Content-Type': 'text/xml' }
    });
  }
}

async function getBusinessSettings(twilioNumber: string) {
  try {
    const formula = encodeURIComponent(`{Twilio Phone Number}='${twilioNumber}'`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}?filterByFormula=${formula}`;
    
    console.log('Fetching from Airtable:', url);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      },
    });
    
    const data = await response.json();
    console.log('Airtable response:', JSON.stringify(data));
    
    if (data.records && data.records.length > 0) {
      const record = data.records[0].fields;
      return {
        name: record['Business Name'],
        ownerPhone: record['Owner Phone Number'],
        bookingLink: record['Booking Link'],
        customMessage: record['SMS Template'],
      };
    }
    
    return null;
  } catch (error) {
    console.error('Airtable error:', error);
    return null;
  }
}

async function sendSMS(to: string, business: any, fromNumber: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  
  let message = business.customMessage || 
    `Hi! Thanks for calling ${business.name}. We can't answer right now, but we can help!\n\n📅 Book an appointment: ${business.bookingLink}\n💬 Or reply to this text with your question\n\nWe'll respond within 1 hour!`;
  
  // Replace {booking_link} placeholder if present
  if (business.bookingLink) {
    message = message.replace('{booking_link}', business.bookingLink);
  }
  
  try {
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          From: fromNumber,
          Body: message,
        }),
      }
    );
    
    console.log('SMS sent to caller:', to);
    const result = await response.json();
    console.log('SMS result:', result);
  } catch (error) {
    console.error('SMS error:', error);
  }
}

async function notifyOwner(business: any, callerNumber: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  
  const message = `🔔 Missed call alert for ${business.name}!\n\nCaller: ${callerNumber}\n\nThey've been sent your booking link and can reply via SMS.`;
  
  try {
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: business.ownerPhone,
          From: fromNumber,
          Body: message,
        }),
      }
    );
    
    console.log('Notification sent to owner:', business.ownerPhone);
  } catch (error) {
    console.error('Owner notification error:', error);
  }
}
