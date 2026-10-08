const express = require("express");
const crypto = require("crypto");
const router = express.Router();

const authMiddleware = require("../middlewares/auth.cjs");
const { requireStaff, requireOwner } = require("../middlewares/staffAuth.cjs");

const { supabaseAdmin } = require("../utils/supabaseAdmin.cjs");
const { sendSupportInviteCodeEmail } = require("../utils/email.cjs");

// Every Support Center endpoint must pass both authentication
// and GigRide staff authorization.

// Public endpoint used by an invited support agent to verify the emailed code.
router.post("/staff/invite/verify", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const code = String(req.body?.code || "").trim();

    if (!email || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Email and 6-digit invite code are required" });
    }

    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
console.log("SUPPORT INVITE DEBUG:", {
  email,
  code,
  codeHash,
});

    const { data: invite, error: lookupError } = await supabaseAdmin
      .from("support_invites")
      .select("*")
      .eq("email", email)
      .eq("code_hash", codeHash)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.error("SUPPORT INVITE VERIFY LOOKUP ERROR:", lookupError.message);
      return res.status(500).json({ error: "Unable to verify invite" });
    }

    if (!invite) {
      return res.status(400).json({ error: "Invalid or expired invite code" });
    }

    const { error: consumeError } = await supabaseAdmin
      .from("support_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("id", invite.id);

    if (consumeError) {
      console.error("SUPPORT INVITE CONSUME ERROR:", consumeError.message);
      return res.status(500).json({ error: "Unable to complete invite" });
    }

    
const { data: authLink, error: authLinkError } =
  await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

if (authLinkError || !authLink?.properties?.hashed_token) {
  console.error(
    "SUPPORT INVITE AUTH TOKEN ERROR:",
    authLinkError?.message || "Missing hashed token"
  );
  return res.status(500).json({ error: "Unable to create support session" });
}

const { data: usersData, error: usersError } =
  await supabaseAdmin.auth.admin.listUsers();

if (usersError) {
  console.error("SUPPORT INVITE USER LOOKUP ERROR:", usersError.message);
  return res.status(500).json({ error: "Unable to authorize support staff" });
}

const invitedUser = usersData.users.find(
  (user) => user.email?.toLowerCase() === email
);

if (!invitedUser?.id) {
  return res.status(404).json({ error: "Invited user not found" });
}
const { data: existingProfile, error: existingProfileError } =
  await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("id", invitedUser.id)
    .maybeSingle();

if (existingProfileError) {
  console.error(
    "SUPPORT INVITE EXISTING PROFILE ERROR:",
    existingProfileError.message
  );
  return res.status(500).json({ error: "Unable to authorize support staff" });
}

const hadExistingProfile = !!existingProfile;
const { error: profileError } = await supabaseAdmin
  .from("profiles")
  .upsert(
    {
      id: invitedUser.id,
      email,
       staff_role: "support_agent",
      
      
    },
    { onConflict: "id" }
  );

if (profileError) {
  console.error("SUPPORT INVITE PROFILE ERROR:", profileError.message);
  return res.status(500).json({ error: "Unable to authorize support staff" });
}

const hashedToken = authLink.properties.hashed_token;
return res.json({
      ok: true,
      email,
hashed_token: hashedToken,
had_existing_profile: hadExistingProfile, 
 });  } catch (error) {
    console.error("SUPPORT INVITE VERIFY ERROR:", error);
    return res.status(500).json({ error: "Unable to verify invite" });
  }
});

router.use(authMiddleware, requireStaff);

// Owner-only staff management.
router.post("/staff/invite", requireOwner, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error: inviteError } = await supabaseAdmin
      .from("support_invites")
      .insert({
        email,
        code_hash: codeHash,
        expires_at: expiresAt,
      });

    if (inviteError) {
      console.error("SUPPORT INVITE CODE ERROR:", inviteError.message);
      return res.status(500).json({ error: "Unable to create support invite" });
    }

    const emailResult = await sendSupportInviteCodeEmail({ to: email, code });

    if (!emailResult?.ok) {
      console.error("SUPPORT INVITE EMAIL ERROR:", emailResult?.error);
      return res.status(500).json({ error: "Unable to send support invite email" });
    }

    return res.status(201).json({
      ok: true,
      email,
      expires_at: expiresAt,
    });

  } catch (error) {
    console.error("SUPPORT STAFF INVITE ERROR:", error);
    return res.status(500).json({ error: "Unable to invite support staff" });
  }
});

router.delete("/staff/:userId/access", requireOwner, async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    if (userId === req.user.id) {
      return res.status(400).json({ error: "You cannot revoke your own staff access" });
    }

    const { data: profile, error: lookupError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, staff_role")
      .eq("id", userId)
      .maybeSingle();

    if (lookupError) {
      console.error("SUPPORT STAFF REVOKE LOOKUP ERROR:", lookupError.message);
      return res.status(500).json({ error: "Unable to verify support staff" });
    }

    if (!profile || profile.staff_role !== "support_agent") {
      return res.status(404).json({ error: "Support agent not found" });
    }

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ staff_role: null })
      .eq("id", userId);

    if (updateError) {
      console.error("SUPPORT STAFF REVOKE ERROR:", updateError.message);
      return res.status(500).json({ error: "Unable to revoke support access" });
    }

    return res.json({
      ok: true,
      user_id: userId,
      email: profile.email,
      staff_role: null,
    });
  } catch (error) {
    console.error("SUPPORT STAFF REVOKE ERROR:", error);
    return res.status(500).json({ error: "Unable to revoke support access" });
  }
});

router.get("/staff", requireOwner, async (req, res) => {
  try {
    const { data: staff, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, staff_role, joined_at")
      .eq("staff_role", "support_agent")
      .order("joined_at", { ascending: false });

    if (error) {
      console.error("SUPPORT STAFF LIST ERROR:", error.message);
      return res.status(500).json({ error: "Unable to load support staff" });
    }

    return res.json({
      ok: true,
      staff: staff || [],
    });
  } catch (error) {
    console.error("SUPPORT STAFF LIST ERROR:", error);
    return res.status(500).json({ error: "Unable to load support staff" });
  }
});

router.get("/me", (req, res) => {
  return res.json({
    ok: true,
    user_id: req.user.id,
    staff_role: req.staffProfile.staff_role,
  });
});

router.get("/bookings", async (req, res) => {
  try {
    const { data: bookings, error } = await supabaseAdmin
      .from("bookings")
      .select(`
        id,
        vehicle_id,
        driver_id,
        host_id,
        start_at,
        end_at,
        start_date,
        end_date,
        pickup_time,
        dropoff_time,
        rental_type,
        status,
        host_approved,
        created_at,
        deposit_paid,
        deposit_paid_at,
        payment_status,
        paid_at,
        insurance_status,
        dispute_status,
        cancelled_at,
        cancelled_by,
        cancellation_reason,
        completed_at,
        vehicles:vehicle_id (
          id,
          year,
          make,
          model,
          trim,
          license_plate,
          plate_state,
          city,
          state,
          verification_status
        ),
        driver:driver_id (
          id,
          full_name,
          email,
          phone,
          identity_status,
          identity_verified,
          mvr_status
        ),
        host:host_id (
          id,
          full_name,
          email,
          phone
        )
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("SUPPORT BOOKINGS ERROR:", error.message);
      return res.status(500).json({ error: "Unable to load bookings" });
    }

    return res.json({
      ok: true,
      bookings: bookings || [],
    });
  } catch (err) {
    console.error("SUPPORT BOOKINGS ERROR:", err);
    return res.status(500).json({ error: "Unable to load bookings" });
  }
});


router.get("/bookings/:bookingId", async (req, res) => {
  try {
    const { bookingId } = req.params;

    const { data: booking, error } = await supabaseAdmin
      .from("bookings")
      .select(`
        id,
        vehicle_id,
        driver_id,
        host_id,
        start_at,
        end_at,
        start_date,
        end_date,
        pickup_time,
        dropoff_time,
        rental_type,
        status,
        host_approved,
        created_at,
        deposit_paid,
        deposit_paid_at,
        payment_status,
        paid_at,
        refund_status,
        insurance_status,
        insurance_provider,
        dispute_status,
        cancelled_at,
        cancelled_by,
        cancellation_reason,
        completed_at,
        damage_notes,
        vehicles:vehicle_id (
          id,
          year,
          make,
          model,
          trim,
          license_plate,
          plate_state,
          city,
          state,
          verification_status
        ),
        driver:driver_id (
          id,
          full_name,
          email,
          phone,
          identity_status,
          identity_verified,
          mvr_status
        ),
        host:host_id (
          id,
          full_name,
          email,
          phone
        )
      `)
      .eq("id", bookingId)
      .maybeSingle();

    if (error) {
      console.error("SUPPORT BOOKING DETAIL ERROR:", error.message);
      return res.status(500).json({ error: "Unable to load booking" });
    }

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    return res.json({
      ok: true,
      booking,
    });
  } catch (err) {
    console.error("SUPPORT BOOKING DETAIL ERROR:", err);
    return res.status(500).json({ error: "Unable to load booking" });
  }
});


router.get("/bookings/:bookingId/messages", async (req, res) => {
  try {
    const { bookingId } = req.params;

    const { data: conversation, error: conversationError } =
      await supabaseAdmin
        .from("conversations")
        .select("id, booking_id, driver_id, host_id")
        .eq("booking_id", bookingId)
        .maybeSingle();

    if (conversationError) {
      console.error(
        "SUPPORT CONVERSATION LOOKUP ERROR:",
        conversationError.message
      );
      return res.status(500).json({ error: "Unable to load conversation" });
    }

    if (!conversation) {
      return res.json({
        ok: true,
        conversation: null,
        messages: [],
      });
    }

    const { data: messages, error: messagesError } = await supabaseAdmin
      .from("messages")
      .select("id, conversation_id, sender_id, body, read_at, created_at")
      .eq("conversation_id", conversation.id)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("SUPPORT MESSAGES ERROR:", messagesError.message);
      return res.status(500).json({ error: "Unable to load messages" });
    }

    return res.json({
      ok: true,
      conversation,
      messages: Array.isArray(messages) ? messages : [],
    });
  } catch (err) {
    console.error("SUPPORT MESSAGES ERROR:", err);
    return res.status(500).json({ error: "Unable to load messages" });
  }
});


router.get("/customers", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (q.length < 2 || q.length > 100) {
      return res.status(400).json({
        error: "Search must contain between 2 and 100 characters",
      });
    }

    const customerFields = `
      id,
      full_name,
      email,
      phone,
      city,
      is_driver,
      is_host,
      joined_at,
      identity_status,
      identity_verified,
      insurance_status,
      mvr_status
    `;

    const searchField = (field) =>
      supabaseAdmin
        .from("profiles")
        .select(customerFields)
        .ilike(field, `%${q}%`)
        .limit(25);

    const [nameResult, emailResult, phoneResult] = await Promise.all([
      searchField("full_name"),
      searchField("email"),
      searchField("phone"),
    ]);

    const searchError =
      nameResult.error || emailResult.error || phoneResult.error;

    if (searchError) {
      console.error("SUPPORT CUSTOMER SEARCH ERROR:", searchError.message);
      return res.status(500).json({ error: "Unable to search customers" });
    }

    const byId = new Map();

    for (const customer of [
      ...(nameResult.data || []),
      ...(emailResult.data || []),
      ...(phoneResult.data || []),
    ]) {
      if (customer?.id) {
        byId.set(customer.id, customer);
      }
    }

    const customers = Array.from(byId.values())
      .sort((a, b) => {
        const aDate = a.joined_at ? new Date(a.joined_at).getTime() : 0;
        const bDate = b.joined_at ? new Date(b.joined_at).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 25);

    return res.json({
      ok: true,
      customers,
    });
  } catch (err) {
    console.error("SUPPORT CUSTOMER SEARCH ERROR:", err);
    return res.status(500).json({ error: "Unable to search customers" });
  }
});


router.get("/customers/:customerId", async (req, res) => {
  try {
    const customerId = String(req.params.customerId || "").trim();

    if (!customerId) {
      return res.status(400).json({ error: "Customer ID is required" });
    }

    const customerFields = `
      id,
      full_name,
      email,
      phone,
      city,
      is_driver,
      is_host,
      joined_at,
      identity_status,
      identity_verified,
      insurance_status,
      mvr_status
    `;

    const { data: customer, error: customerError } = await supabaseAdmin
      .from("profiles")
      .select(customerFields)
      .eq("id", customerId)
      .maybeSingle();

    if (customerError) {
      console.error("SUPPORT CUSTOMER DETAIL ERROR:", customerError.message);
      return res.status(500).json({ error: "Unable to load customer" });
    }

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const bookingFields = `
      id,
      vehicle_id,
      driver_id,
      host_id,
      start_at,
      end_at,
      start_date,
      end_date,
      pickup_time,
      dropoff_time,
      rental_type,
      status,
      host_approved,
      created_at,
      deposit_paid,
      deposit_paid_at,
      payment_status,
      paid_at,
      insurance_status,
      insurance_provider,
      dispute_status,
      cancelled_at,
      cancelled_by,
      cancellation_reason,
      completed_at,
      vehicles (
        id,
        year,
        make,
        model,
        trim,
        license_plate,
        plate_state,
        city,
        state,
        verification_status
      )
    `;

    const bookingQuery = (field) =>
      supabaseAdmin
        .from("bookings")
        .select(bookingFields)
        .eq(field, customerId)
        .order("created_at", { ascending: false })
        .limit(100);

    const [driverBookingsResult, hostBookingsResult] = await Promise.all([
      bookingQuery("driver_id"),
      bookingQuery("host_id"),
    ]);

    const bookingsError =
      driverBookingsResult.error || hostBookingsResult.error;

    if (bookingsError) {
      console.error(
        "SUPPORT CUSTOMER BOOKINGS ERROR:",
        bookingsError.message
      );
      return res.status(500).json({
        error: "Unable to load customer bookings",
      });
    }

    const bookingsById = new Map();

    for (const booking of [
      ...(driverBookingsResult.data || []),
      ...(hostBookingsResult.data || []),
    ]) {
      if (booking?.id) {
        bookingsById.set(booking.id, booking);
      }
    }

    const bookings = Array.from(bookingsById.values())
      .sort((a, b) => {
        const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bDate - aDate;
      })
      .slice(0, 100);

    return res.json({
      ok: true,
      customer,
      bookings,
    });
  } catch (err) {
    console.error("SUPPORT CUSTOMER DETAIL ERROR:", err);
    return res.status(500).json({ error: "Unable to load customer" });
  }
});


// List support cases for staff.
router.get("/cases", async (req, res) => {
  try {
    const { data: cases, error } = await supabaseAdmin
      .from("support_cases")
      .select(`
        id,
        customer_id,
        booking_id,
        subject,
        description,
        category,
        priority,
        status,
        assigned_to,
        created_by,
        escalated_to_owner_at,
        resolved_at,
        closed_at,
        created_at,
        updated_at
      `)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("SUPPORT CASE LIST ERROR:", error.message);
      return res.status(500).json({ error: "Unable to load support cases" });
    }

    return res.json({
      ok: true,
      cases: Array.isArray(cases) ? cases : [],
    });
  } catch (err) {
    console.error("SUPPORT CASE LIST ERROR:", err);
    return res.status(500).json({ error: "Unable to load support cases" });
  }
});


// Create a support case.
router.post("/cases", async (req, res) => {
  try {
    const customerId = String(req.body?.customer_id || "").trim();
    const bookingId = req.body?.booking_id
      ? String(req.body.booking_id).trim()
      : null;
    const subject = String(req.body?.subject || "").trim();
    const description = String(req.body?.description || "").trim() || null;
    const category = String(req.body?.category || "general").trim();
    const priority = String(req.body?.priority || "normal").trim();

    const allowedCategories = new Set([
      "general",
      "booking",
      "payment",
      "insurance",
      "identity",
      "mvr",
      "vehicle",
      "host",
      "driver",
      "technical",
      "other",
    ]);

    const allowedPriorities = new Set([
      "low",
      "normal",
      "high",
      "urgent",
    ]);

    if (!customerId) {
      return res.status(400).json({ error: "Customer ID is required" });
    }

    if (!subject || subject.length > 200) {
      return res.status(400).json({
        error: "Subject must contain between 1 and 200 characters",
      });
    }

    if (description && description.length > 5000) {
      return res.status(400).json({
        error: "Description cannot exceed 5000 characters",
      });
    }

    if (!allowedCategories.has(category)) {
      return res.status(400).json({ error: "Invalid case category" });
    }

    if (!allowedPriorities.has(priority)) {
      return res.status(400).json({ error: "Invalid case priority" });
    }

    const { data: customer, error: customerError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();

    if (customerError) {
      console.error("SUPPORT CASE CUSTOMER ERROR:", customerError.message);
      return res.status(500).json({ error: "Unable to verify customer" });
    }

    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    if (bookingId) {
      const { data: booking, error: bookingError } = await supabaseAdmin
        .from("bookings")
        .select("id, driver_id, host_id")
        .eq("id", bookingId)
        .maybeSingle();

      if (bookingError) {
        console.error("SUPPORT CASE BOOKING ERROR:", bookingError.message);
        return res.status(500).json({ error: "Unable to verify booking" });
      }

      if (!booking) {
        return res.status(404).json({ error: "Booking not found" });
      }

      if (
        booking.driver_id !== customerId &&
        booking.host_id !== customerId
      ) {
        return res.status(400).json({
          error: "Booking does not belong to this customer",
        });
      }
    }

    const { data: supportCase, error: insertError } = await supabaseAdmin
      .from("support_cases")
      .insert({
        customer_id: customerId,
        booking_id: bookingId,
        subject,
        description,
        category,
        priority,
        status: "open",
        created_by: req.user.id,
      })
      .select(`
        id,
        customer_id,
        booking_id,
        subject,
        description,
        category,
        priority,
        status,
        assigned_to,
        created_by,
        escalated_to_owner_at,
        resolved_at,
        closed_at,
        created_at,
        updated_at
      `)
      .single();

    if (insertError) {
      console.error("SUPPORT CASE CREATE ERROR:", insertError.message);
      return res.status(500).json({ error: "Unable to create support case" });
    }

    return res.status(201).json({
      ok: true,
      case: supportCase,
    });
  } catch (err) {
    console.error("SUPPORT CASE CREATE ERROR:", err);
    return res.status(500).json({ error: "Unable to create support case" });
  }
});


// Load one support case and its internal notes.
router.get("/cases/:caseId", async (req, res) => {
  try {
    const caseId = String(req.params.caseId || "").trim();

    if (!caseId) {
      return res.status(400).json({ error: "Case ID is required" });
    }

    const { data: supportCase, error: caseError } = await supabaseAdmin
      .from("support_cases")
      .select(`
        id,
        customer_id,
        booking_id,
        subject,
        description,
        category,
        priority,
        status,
        assigned_to,
        created_by,
        escalated_to_owner_at,
        resolved_at,
        closed_at,
        created_at,
        updated_at
      `)
      .eq("id", caseId)
      .maybeSingle();

    if (caseError) {
      console.error("SUPPORT CASE DETAIL ERROR:", caseError.message);
      return res.status(500).json({ error: "Unable to load support case" });
    }

    if (!supportCase) {
      return res.status(404).json({ error: "Support case not found" });
    }

    const customerPromise = supabaseAdmin
      .from("profiles")
      .select(`
        id,
        full_name,
        email,
        phone,
        city,
        is_driver,
        is_host,
        identity_status,
        identity_verified,
        insurance_status,
        mvr_status
      `)
      .eq("id", supportCase.customer_id)
      .maybeSingle();

    const notesPromise = supabaseAdmin
      .from("support_case_notes")
      .select(`
        id,
        case_id,
        author_id,
        body,
        created_at
      `)
      .eq("case_id", caseId)
      .order("created_at", { ascending: true });

    const bookingPromise = supportCase.booking_id
      ? supabaseAdmin
          .from("bookings")
          .select(`
            id,
            vehicle_id,
            driver_id,
            host_id,
            start_at,
            end_at,
            start_date,
            end_date,
            status,
            payment_status,
            insurance_status,
            dispute_status,
            created_at
          `)
          .eq("id", supportCase.booking_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null });

    const [customerResult, notesResult, bookingResult] =
      await Promise.all([
        customerPromise,
        notesPromise,
        bookingPromise,
      ]);

    const relatedError =
      customerResult.error ||
      notesResult.error ||
      bookingResult.error;

    if (relatedError) {
      console.error(
        "SUPPORT CASE RELATED DATA ERROR:",
        relatedError.message
      );
      return res.status(500).json({
        error: "Unable to load support case details",
      });
    }

    return res.json({
      ok: true,
      case: supportCase,
      customer: customerResult.data || null,
      booking: bookingResult.data || null,
      notes: Array.isArray(notesResult.data)
        ? notesResult.data
        : [],
    });
  } catch (err) {
    console.error("SUPPORT CASE DETAIL ERROR:", err);
    return res.status(500).json({ error: "Unable to load support case" });
  }
});


// Add an internal staff note to a support case.
router.post("/cases/:caseId/notes", async (req, res) => {
  try {
    const caseId = String(req.params.caseId || "").trim();
    const body = String(req.body?.body || "").trim();

    if (!caseId) {
      return res.status(400).json({ error: "Case ID is required" });
    }

    if (!body || body.length > 5000) {
      return res.status(400).json({
        error: "Note must contain between 1 and 5000 characters",
      });
    }

    const { data: supportCase, error: caseError } = await supabaseAdmin
      .from("support_cases")
      .select("id")
      .eq("id", caseId)
      .maybeSingle();

    if (caseError) {
      console.error("SUPPORT CASE NOTE LOOKUP ERROR:", caseError.message);
      return res.status(500).json({ error: "Unable to verify support case" });
    }

    if (!supportCase) {
      return res.status(404).json({ error: "Support case not found" });
    }

    const { data: note, error: noteError } = await supabaseAdmin
      .from("support_case_notes")
      .insert({
        case_id: caseId,
        author_id: req.user.id,
        body,
      })
      .select(`
        id,
        case_id,
        author_id,
        body,
        created_at
      `)
      .single();

    if (noteError) {
      console.error("SUPPORT CASE NOTE CREATE ERROR:", noteError.message);
      return res.status(500).json({ error: "Unable to add internal note" });
    }

    const { error: updateError } = await supabaseAdmin
      .from("support_cases")
      .update({
        updated_at: new Date().toISOString(),
      })
      .eq("id", caseId);

    if (updateError) {
      console.error(
        "SUPPORT CASE NOTE TIMESTAMP ERROR:",
        updateError.message
      );
    }

    return res.status(201).json({
      ok: true,
      note,
    });
  } catch (err) {
    console.error("SUPPORT CASE NOTE CREATE ERROR:", err);
    return res.status(500).json({ error: "Unable to add internal note" });
  }
});


// Update the workflow status of a support case.
router.patch("/cases/:caseId/status", async (req, res) => {
  try {
    const caseId = String(req.params.caseId || "").trim();
    const status = String(req.body?.status || "").trim();

    const allowedStatuses = new Set([
      "open",
      "in_progress",
      "waiting_on_customer",
      "resolved",
      "closed",
    ]);

    if (!caseId) {
      return res.status(400).json({ error: "Case ID is required" });
    }

    // Escalation uses a separate endpoint so owner escalation
    // cannot be triggered through a generic status update.
    if (!allowedStatuses.has(status)) {
      return res.status(400).json({ error: "Invalid case status" });
    }

    const now = new Date().toISOString();

    const updates = {
      status,
      updated_at: now,
      resolved_at: status === "resolved" ? now : null,
      closed_at: status === "closed" ? now : null,
    };

    const { data: supportCase, error } = await supabaseAdmin
      .from("support_cases")
      .update(updates)
      .eq("id", caseId)
      .select(`
        id,
        customer_id,
        booking_id,
        subject,
        category,
        priority,
        status,
        assigned_to,
        created_by,
        escalated_to_owner_at,
        resolved_at,
        closed_at,
        created_at,
        updated_at
      `)
      .maybeSingle();

    if (error) {
      console.error("SUPPORT CASE STATUS ERROR:", error.message);
      return res.status(500).json({ error: "Unable to update support case" });
    }

    if (!supportCase) {
      return res.status(404).json({ error: "Support case not found" });
    }

    return res.json({
      ok: true,
      case: supportCase,
    });
  } catch (err) {
    console.error("SUPPORT CASE STATUS ERROR:", err);
    return res.status(500).json({ error: "Unable to update support case" });
  }
});


// Escalate a support case to the GigRide owner.
router.post("/cases/:caseId/escalate", async (req, res) => {
  try {
    const caseId = String(req.params.caseId || "").trim();
    const ownerId = String(process.env.GIGRIDE_OWNER_USER_ID || "").trim();

    if (!caseId) {
      return res.status(400).json({ error: "Case ID is required" });
    }

    if (!ownerId) {
      console.error("SUPPORT CASE ESCALATION ERROR: owner user ID is not configured");
      return res.status(500).json({ error: "Owner escalation is unavailable" });
    }

    const { data: owner, error: ownerError } = await supabaseAdmin
      .from("profiles")
      .select("id, staff_role")
      .eq("id", ownerId)
      .maybeSingle();

    if (ownerError) {
      console.error("SUPPORT CASE OWNER LOOKUP ERROR:", ownerError.message);
      return res.status(500).json({ error: "Unable to verify owner account" });
    }

    if (!owner || owner.staff_role !== "owner") {
      console.error("SUPPORT CASE ESCALATION ERROR: configured owner is invalid");
      return res.status(500).json({ error: "Owner escalation is unavailable" });
    }

    const now = new Date().toISOString();

    const { data: supportCase, error } = await supabaseAdmin
      .from("support_cases")
      .update({
          assigned_to: ownerId,
        escalated_to_owner_at: now,
            updated_at: now,
      })
      .eq("id", caseId)
      .select(`
        id,
        customer_id,
        booking_id,
        subject,
        category,
        priority,
        status,
        assigned_to,
        created_by,
        escalated_to_owner_at,
        resolved_at,
        closed_at,
        created_at,
        updated_at
      `)
      .maybeSingle();

    if (error) {
      console.error("SUPPORT CASE ESCALATION ERROR:", error.message);
      return res.status(500).json({ error: "Unable to escalate support case" });
    }

    if (!supportCase) {
      return res.status(404).json({ error: "Support case not found" });
    }

    return res.json({
      ok: true,
      case: supportCase,
    });
  } catch (err) {
    console.error("SUPPORT CASE ESCALATION ERROR:", err);
    return res.status(500).json({ error: "Unable to escalate support case" });
  }
});

module.exports = router;
