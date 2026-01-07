import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Businesses';

export async function POST(req: NextRequest) {
  try {
    console.log('📱 Incoming SMS');
    
    const formData = await req.formData();
    const data = Object.fromEntries(formData);
    
    const fromNumber = data.From as string;
    const toNumber = data.To as string;
    const messageBody = data.Body as string;
    
    console.log(`SMS from ${fromNumber} to ${toNumber}: ${messageBody}`);
    
    const business = await getBusinessSettings(toNumber);
    
    if (!business) {
      console.error('No business found for number:', toNumber);
      return new NextResponse('', { status: 200 });
    }
    
    await forwardToOwner(business, fromNumber, messageBody);
    
    const replyXml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Thanks for your message! ${business.name} will respond soon.</Message></Response>`;
    
    return new NextResponse(replyXml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
    
  } catch (error) {
    console.error('SMS error:', error);
    return new NextResponse('', { status: 200 });
  }
}

async function getBusinessSettings(twilioNumber: string) {
  try {
    const formula = encodeURIComponent(`{Twilio Phone Number}='${twilioNumber}'`);
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}?filterByFormula=${formula}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
      },
    });
    
    const data = await response.json();
    
    if (data.records && data.records.length > 0) {
      const record = data.records[0].fields;
      return {
        name: record['Business Name'] as string,
        ownerPhone: record['Owner Phone Number'] as string,
      };
    }
    
    return null;
  } catch (error) {
    console.error('Airtable error:', error);
    return null;
  }
}

async function forwardToOwner(business: { name: string; ownerPhone: string }, customerNumber: string, messageBody: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  
  if (!accountSid || !authToken || !fromNumber) {
    console.error('Missing Twilio credentials');
    return;
  }
  
  const message = `[CUSTOMER MESSAGE] ${business.name}

From: ${customerNumber}

Message: ${messageBody}

Reply to this thread to respond to the customer.`;
  
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
        }).toString(),
      }
    );
    
    console.log('Message forwarded to owner:', business.ownerPhone);
  } catch (error) {
    console.error('Forward error:', error);
  }
}
