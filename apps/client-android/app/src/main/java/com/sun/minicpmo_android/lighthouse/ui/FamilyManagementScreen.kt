package com.sun.minicpmo_android.lighthouse.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Assignment
import androidx.compose.material.icons.automirrored.rounded.EventNote
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Devices
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Key
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.PrivacyTip
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Security
import androidx.compose.material.icons.rounded.TaskAlt
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.sun.minicpmo_android.lighthouse.model.CareRecipientInput
import com.sun.minicpmo_android.lighthouse.model.CareEventView
import com.sun.minicpmo_android.lighthouse.model.CareAuthorityInput
import com.sun.minicpmo_android.lighthouse.model.CareAuthorityView
import com.sun.minicpmo_android.lighthouse.model.CompanionBindingView
import com.sun.minicpmo_android.lighthouse.model.ConsentCatalog
import com.sun.minicpmo_android.lighthouse.model.ConsentScopeDefinition
import com.sun.minicpmo_android.lighthouse.model.FamilyTaskView
import com.sun.minicpmo_android.lighthouse.model.LighthouseUiState
import com.sun.minicpmo_android.lighthouse.model.HouseholdMemberView
import com.sun.minicpmo_android.lighthouse.model.MemoryInput
import com.sun.minicpmo_android.lighthouse.model.MemoryView
import com.sun.minicpmo_android.lighthouse.model.OccurrenceView
import com.sun.minicpmo_android.lighthouse.model.RoutineInput
import com.sun.minicpmo_android.lighthouse.model.RoutineView
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.TimeZone

internal class FamilyUiActions(
    val requestEmailVerification: (String?, String?) -> Unit,
    val confirmEmailVerification: (String, String) -> Unit,
    val dismissEmailVerificationPrompt: () -> Unit,
    val selectHousehold: (String) -> Unit,
    val selectRecipient: (String) -> Unit,
    val createHousehold: (String, String) -> Unit,
    val createRecipient: (CareRecipientInput) -> Unit,
    val createActivation: (String) -> Unit,
    val loadActivationApprovalDetails: (String) -> Unit,
    val approveActivation: (String) -> Unit,
    val requestCall: (String) -> Unit,
    val createMemory: (MemoryInput) -> Unit,
    val updateMemory: (MemoryView, MemoryInput) -> Unit,
    val deleteMemory: (MemoryView) -> Unit,
    val createRoutine: (RoutineInput) -> Unit,
    val updateRoutine: (RoutineView, RoutineInput) -> Unit,
    val deleteRoutine: (RoutineView) -> Unit,
    val verifyOccurrence: (OccurrenceView, Boolean, String?) -> Unit,
    val claimFamilyTask: (FamilyTaskView) -> Unit,
    val finishFamilyTask: (FamilyTaskView, Boolean, String?) -> Unit,
    val decideConsent: (String, Boolean) -> Unit,
    val loadCareAuthorities: () -> Unit,
    val updateHouseholdMember: (HouseholdMemberView, Set<String>, String) -> Unit,
    val removeHouseholdMember: (HouseholdMemberView, String) -> Unit,
    val putCareAuthority: (String, CareAuthorityInput, String) -> Unit,
    val revokeBinding: (CompanionBindingView, String?, String) -> Unit,
)

private enum class FamilySection(
    val label: String,
    val icon: ImageVector,
) {
    OVERVIEW("概览", Icons.Rounded.Home),
    MEMORIES("记忆", Icons.AutoMirrored.Rounded.MenuBook),
    CARE("照护", Icons.Rounded.CalendarMonth),
    PRIVACY("授权", Icons.Rounded.PrivacyTip),
    ACCESS("成员", Icons.Rounded.VerifiedUser),
}

private data class TaskDecision(
    val task: FamilyTaskView,
    val resolve: Boolean,
)

private data class OccurrenceDecision(
    val occurrence: OccurrenceView,
    val verified: Boolean,
)

private data class ConsentDecision(
    val definition: ConsentScopeDefinition,
    val grant: Boolean,
)

@Composable
internal fun FamilyManagementContent(
    state: LighthouseUiState,
    actions: FamilyUiActions,
    onRequestEmailVerification: () -> Unit,
) {
    var section by rememberSaveable { mutableStateOf(FamilySection.OVERVIEW) }
    var createHouseholdVisible by remember { mutableStateOf(false) }
    var createRecipientVisible by remember { mutableStateOf(false) }
    var memoryEditor by remember { mutableStateOf<MemoryView?>(null) }
    var memoryEditorVisible by remember { mutableStateOf(false) }
    var memoryDelete by remember { mutableStateOf<MemoryView?>(null) }
    var routineEditor by remember { mutableStateOf<RoutineView?>(null) }
    var routineEditorVisible by remember { mutableStateOf(false) }
    var routineDelete by remember { mutableStateOf<RoutineView?>(null) }
    var taskDecision by remember { mutableStateOf<TaskDecision?>(null) }
    var occurrenceDecision by remember { mutableStateOf<OccurrenceDecision?>(null) }
    var consentDecision by remember { mutableStateOf<ConsentDecision?>(null) }
    var authorityEditor by remember { mutableStateOf<HouseholdMemberView?>(null) }
    var memberRoleEditor by remember { mutableStateOf<HouseholdMemberView?>(null) }
    var memberRemoval by remember { mutableStateOf<HouseholdMemberView?>(null) }
    var bindingRevoke by remember { mutableStateOf<CompanionBindingView?>(null) }

    val selectSection: (FamilySection) -> Unit = { item ->
        section = item
        if (
            item == FamilySection.ACCESS &&
            state.selectedHousehold?.roleCodes?.contains("OWNER") == true &&
            state.selectedRecipientId != null &&
            state.authoritiesLoadedRecipientId != state.selectedRecipientId
        ) {
            actions.loadCareAuthorities()
        }
    }

    BackHandler(enabled = section != FamilySection.OVERVIEW) {
        section = FamilySection.OVERVIEW
    }

    Column(Modifier.fillMaxSize()) {
        WorkspaceSelector(
            state = state,
            onSelectHousehold = actions.selectHousehold,
            onSelectRecipient = actions.selectRecipient,
            onAddHousehold = { createHouseholdVisible = true },
            onAddRecipient = { createRecipientVisible = true },
        )
        HorizontalDivider()
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth(),
        ) {
            when (section) {
                FamilySection.OVERVIEW -> OverviewSection(
                    state = state,
                    onRequestEmailVerification = onRequestEmailVerification,
                    onAddHousehold = { createHouseholdVisible = true },
                    onAddRecipient = { createRecipientVisible = true },
                    onCreateActivation = actions.createActivation,
                    onRequestCall = actions.requestCall,
                    onRevokeBinding = { bindingRevoke = it },
                )
                FamilySection.MEMORIES -> MemoriesSection(
                    state = state,
                    onAdd = {
                        memoryEditor = null
                        memoryEditorVisible = true
                    },
                    onEdit = {
                        memoryEditor = it
                        memoryEditorVisible = true
                    },
                    onDelete = { memoryDelete = it },
                )
                FamilySection.CARE -> CareSection(
                    state = state,
                    onAddRoutine = {
                        routineEditor = null
                        routineEditorVisible = true
                    },
                    onEditRoutine = {
                        routineEditor = it
                        routineEditorVisible = true
                    },
                    onDeleteRoutine = { routineDelete = it },
                    onVerifyOccurrence = { occurrence, verified ->
                        occurrenceDecision = OccurrenceDecision(occurrence, verified)
                    },
                    onClaimTask = actions.claimFamilyTask,
                    onFinishTask = { task, resolve ->
                        taskDecision = TaskDecision(task, resolve)
                    },
                )
                FamilySection.PRIVACY -> PrivacySection(
                    state = state,
                    onDecide = { definition, grant ->
                        consentDecision = ConsentDecision(definition, grant)
                    },
                )
                FamilySection.ACCESS -> AuthoritySection(
                    state = state,
                    onLoad = actions.loadCareAuthorities,
                    onEditAuthority = { authorityEditor = it },
                    onEditRoles = { memberRoleEditor = it },
                    onRemoveMember = { memberRemoval = it },
                )
            }
        }
        HorizontalDivider()
        NavigationBar(Modifier.fillMaxWidth()) {
            FamilySection.entries.forEach { item ->
                NavigationBarItem(
                    selected = section == item,
                    onClick = { selectSection(item) },
                    icon = {
                        Icon(item.icon, contentDescription = null)
                    },
                    label = {
                        Text(item.label, maxLines = 1)
                    },
                    alwaysShowLabel = true,
                )
            }
        }
    }

    memberRoleEditor?.let { member ->
        HouseholdMemberRoleDialog(
            member = member,
            busy = state.busy,
            onDismiss = { memberRoleEditor = null },
            onSave = { roleCodes, currentPassword ->
                memberRoleEditor = null
                actions.updateHouseholdMember(member, roleCodes, currentPassword)
            },
        )
    }

    memberRemoval?.let { member ->
        RemoveHouseholdMemberDialog(
            member = member,
            busy = state.busy,
            onDismiss = { memberRemoval = null },
            onConfirm = { currentPassword ->
                memberRemoval = null
                actions.removeHouseholdMember(member, currentPassword)
            },
        )
    }

    authorityEditor?.let { member ->
        CareAuthorityEditorDialog(
            member = member,
            authority = state.careAuthorities.firstOrNull { it.memberId == member.id },
            busy = state.busy,
            onDismiss = { authorityEditor = null },
            onSave = { input, currentPassword ->
                authorityEditor = null
                actions.putCareAuthority(member.id, input, currentPassword)
            },
        )
    }

    bindingRevoke?.let { binding ->
        RevokeBindingDialog(
            binding = binding,
            busy = state.busy,
            onDismiss = { bindingRevoke = null },
            onConfirm = { reasonCode, currentPassword ->
                bindingRevoke = null
                actions.revokeBinding(binding, reasonCode, currentPassword)
            },
        )
    }

    if (createHouseholdVisible) {
        HouseholdEditorDialog(
            busy = state.busy,
            onDismiss = { createHouseholdVisible = false },
            onSave = { name, timezone ->
                actions.createHousehold(name, timezone)
                createHouseholdVisible = false
            },
        )
    }
    if (createRecipientVisible && state.selectedHouseholdId != null) {
        RecipientEditorDialog(
            busy = state.busy,
            defaultTimezone = state.selectedHousehold?.timezone ?: localTimezone(),
            onDismiss = { createRecipientVisible = false },
            onSave = {
                actions.createRecipient(it)
                createRecipientVisible = false
            },
        )
    }
    if (memoryEditorVisible && state.selectedRecipientId != null) {
        MemoryEditorDialog(
            memory = memoryEditor,
            busy = state.busy,
            onDismiss = { memoryEditorVisible = false },
            onSave = { input ->
                memoryEditor?.let { actions.updateMemory(it, input) }
                    ?: actions.createMemory(input)
                memoryEditorVisible = false
            },
        )
    }
    memoryDelete?.let { memory ->
        ConfirmDeleteDialog(
            title = "删除记忆",
            body = "确认删除“${memory.title}”吗？删除后将无法在陪伴中使用。",
            busy = state.busy,
            onDismiss = { memoryDelete = null },
            onConfirm = {
                actions.deleteMemory(memory)
                memoryDelete = null
            },
        )
    }
    val selectedRecipient = state.selectedRecipient
    if (routineEditorVisible && selectedRecipient != null) {
        RoutineEditorDialog(
            routine = routineEditor,
            defaultTimezone = selectedRecipient.timezone,
            busy = state.busy,
            onDismiss = { routineEditorVisible = false },
            onSave = { input ->
                routineEditor?.let { actions.updateRoutine(it, input) }
                    ?: actions.createRoutine(input)
                routineEditorVisible = false
            },
        )
    }
    routineDelete?.let { routine ->
        ConfirmDeleteDialog(
            title = "删除日程",
            body = "确认删除“${routine.title}”吗？新的提醒实例将不再生成。",
            busy = state.busy,
            onDismiss = { routineDelete = null },
            onConfirm = {
                actions.deleteRoutine(routine)
                routineDelete = null
            },
        )
    }
    occurrenceDecision?.let { decision ->
        OccurrenceDecisionDialog(
            decision = decision,
            busy = state.busy,
            onDismiss = { occurrenceDecision = null },
            onConfirm = { note ->
                actions.verifyOccurrence(decision.occurrence, decision.verified, note)
                occurrenceDecision = null
            },
        )
    }
    taskDecision?.let { decision ->
        TaskDecisionDialog(
            decision = decision,
            busy = state.busy,
            onDismiss = { taskDecision = null },
            onConfirm = { note ->
                actions.finishFamilyTask(decision.task, decision.resolve, note)
                taskDecision = null
            },
        )
    }
    consentDecision?.let { decision ->
        ConsentDecisionDialog(
            decision = decision,
            busy = state.busy,
            onDismiss = { consentDecision = null },
            onConfirm = {
                actions.decideConsent(decision.definition.scope, decision.grant)
                consentDecision = null
            },
        )
    }
}

@Composable
private fun WorkspaceSelector(
    state: LighthouseUiState,
    onSelectHousehold: (String) -> Unit,
    onSelectRecipient: (String) -> Unit,
    onAddHousehold: () -> Unit,
    onAddRecipient: () -> Unit,
) {
    var householdMenuExpanded by remember { mutableStateOf(false) }
    var recipientMenuExpanded by remember { mutableStateOf(false) }

    OutlinedCard(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            WorkspaceContextRow(
                label = "家庭",
                selectedId = state.selectedHouseholdId,
                selectedLabel = state.selectedHousehold?.name ?: "选择家庭",
                options = state.households.map { it.id to it.name },
                expanded = householdMenuExpanded,
                onExpandedChange = { householdMenuExpanded = it },
                onSelect = onSelectHousehold,
                actionLabel = "新建家庭",
                onAction = onAddHousehold,
            )
            if (state.selectedHouseholdId != null) {
                WorkspaceContextRow(
                    label = "长者",
                    selectedId = state.selectedRecipientId,
                    selectedLabel = state.selectedRecipient?.preferredName ?: "选择长者",
                    options = state.recipients.map { it.id to it.preferredName },
                    expanded = recipientMenuExpanded,
                    onExpandedChange = { recipientMenuExpanded = it },
                    onSelect = onSelectRecipient,
                    actionLabel = "添加长者",
                    onAction = onAddRecipient,
                )
            }
        }
    }
}

@Composable
private fun WorkspaceContextRow(
    label: String,
    selectedId: String?,
    selectedLabel: String,
    options: List<Pair<String, String>>,
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    onSelect: (String) -> Unit,
    actionLabel: String,
    onAction: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelLarge,
            modifier = Modifier.width(40.dp),
        )
        Box(Modifier.weight(1f)) {
            OutlinedButton(
                onClick = { onExpandedChange(true) },
                enabled = options.isNotEmpty(),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                contentPadding = PaddingValues(horizontal = 12.dp),
            ) {
                Text(
                    selectedLabel,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Icon(Icons.Rounded.KeyboardArrowDown, contentDescription = null)
            }
            DropdownMenu(
                expanded = expanded && options.isNotEmpty(),
                onDismissRequest = { onExpandedChange(false) },
            ) {
                options.forEach { (id, optionLabel) ->
                    DropdownMenuItem(
                        text = {
                            Text(optionLabel, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        },
                        onClick = {
                            onExpandedChange(false)
                            onSelect(id)
                        },
                        leadingIcon = {
                            if (id == selectedId) {
                                Icon(Icons.Rounded.CheckCircle, contentDescription = "当前选择")
                            } else {
                                Spacer(Modifier.size(24.dp))
                            }
                        },
                    )
                }
            }
        }
        TextButton(
            onClick = onAction,
            modifier = Modifier.heightIn(min = 48.dp),
            contentPadding = PaddingValues(horizontal = 8.dp),
        ) {
            Icon(Icons.Rounded.Add, contentDescription = null, Modifier.size(18.dp))
            Spacer(Modifier.width(4.dp))
            Text(actionLabel, maxLines = 1)
        }
    }
}

@Composable
private fun OverviewSection(
    state: LighthouseUiState,
    onRequestEmailVerification: () -> Unit,
    onAddHousehold: () -> Unit,
    onAddRecipient: () -> Unit,
    onCreateActivation: (String) -> Unit,
    onRequestCall: (String) -> Unit,
    onRevokeBinding: (CompanionBindingView) -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (state.user?.emailVerified == false) {
            item {
                ActionNotice(
                    icon = Icons.Rounded.Security,
                    title = "请先验证邮箱",
                    body = "验证邮箱后即可创建家庭和添加设备。",
                    actionLabel = "发送邮箱验证码",
                    onAction = onRequestEmailVerification,
                )
            }
        }
        when {
            state.households.isEmpty() -> item {
                SetupCard(
                    icon = Icons.Rounded.Home,
                    title = "创建第一个家庭",
                    body = "填写家庭名称和所在时区。",
                    actionLabel = "创建家庭",
                    onAction = onAddHousehold,
                )
            }
            state.recipients.isEmpty() -> item {
                SetupCard(
                    icon = Icons.Rounded.Person,
                    title = "添加陪伴对象",
                    body = "填写长者的称呼、位置和时区。",
                    actionLabel = "添加长者",
                    onAction = onAddRecipient,
                )
            }
            else -> {
                state.selectedRecipient?.let { recipient ->
                    item {
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.primaryContainer,
                            ),
                        ) {
                            Column(
                                Modifier.fillMaxWidth().padding(20.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text("当前陪伴对象", style = MaterialTheme.typography.labelLarge)
                                Text(
                                    recipient.preferredName,
                                    style = MaterialTheme.typography.headlineMedium,
                                    fontWeight = FontWeight.Bold,
                                )
                                Text(
                                    listOfNotNull(
                                        recipient.homeLabel?.takeIf(String::isNotBlank),
                                        timezoneDisplayLabel(recipient.timezone),
                                    )
                                        .joinToString(" · "),
                                    style = MaterialTheme.typography.bodyLarge,
                                )
                            }
                        }
                    }
                    item {
                        SectionHeading("陪伴设备", Icons.Rounded.Devices)
                        val binding = state.bindings.firstOrNull {
                            it.recipientId == recipient.id && it.status == "ACTIVE"
                        }
                        OutlinedCard(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                            Column(
                                Modifier.fillMaxWidth().padding(18.dp),
                                verticalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                if (binding == null) {
                                    Text("尚未绑定设备", style = MaterialTheme.typography.titleMedium)
                                    Text(
                                        "生成激活码后，在此确认设备。",
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    Button(
                                        onClick = { onCreateActivation(recipient.id) },
                                        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                                    ) {
                                        Icon(Icons.Rounded.Key, contentDescription = null)
                                        Spacer(Modifier.width(8.dp))
                                        Text("生成设备激活码")
                                    }
                                } else {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            Icons.Rounded.Devices,
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary,
                                        )
                                        Spacer(Modifier.width(12.dp))
                                        Column(Modifier.weight(1f)) {
                                            Text(binding.displayName, fontWeight = FontWeight.SemiBold)
                                            Text(
                                                "已绑定 · 运行正常",
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                    Button(
                                        onClick = { onRequestCall(binding.id) },
                                        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                                    ) {
                                        Icon(Icons.Rounded.Call, contentDescription = null)
                                        Spacer(Modifier.width(8.dp))
                                        Text("呼叫陪伴设备")
                                    }
                                    Text(
                                        "需要陪伴设备现场接听。",
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                    TextButton(
                                        onClick = { onRevokeBinding(binding) },
                                        modifier = Modifier
                                            .align(Alignment.End)
                                            .heightIn(min = 48.dp),
                                        colors = ButtonDefaults.textButtonColors(
                                            contentColor = MaterialTheme.colorScheme.error,
                                        ),
                                    ) {
                                        Icon(
                                            Icons.Rounded.Delete,
                                            contentDescription = null,
                                            modifier = Modifier.size(18.dp),
                                        )
                                        Spacer(Modifier.width(6.dp))
                                        Text("解绑设备")
                                    }
                                }
                            }
                        }
                    }
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        MetricCard("记忆", state.memories.size.toString(), Modifier.weight(1f))
                        MetricCard("日程", state.routines.size.toString(), Modifier.weight(1f))
                        MetricCard(
                            "待办",
                            state.familyTasks.count { it.status in setOf("OPEN", "CLAIMED") }.toString(),
                            Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AuthoritySection(
    state: LighthouseUiState,
    onLoad: () -> Unit,
    onEditAuthority: (HouseholdMemberView) -> Unit,
    onEditRoles: (HouseholdMemberView) -> Unit,
    onRemoveMember: (HouseholdMemberView) -> Unit,
) {
    val recipient = state.selectedRecipient
    val canManageMembers = state.selectedHousehold?.roleCodes?.contains("OWNER") == true
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SectionHeading("成员照护权限", Icons.Rounded.VerifiedUser)
        }
        if (!canManageMembers) {
            item {
                Text(
                    "仅家庭所有者可以管理成员权限。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@LazyColumn
        }
        if (recipient == null) {
            item { Text("请先选择陪伴对象") }
            return@LazyColumn
        }
        if (state.authoritiesLoadedRecipientId != recipient.id) {
            item {
                Button(
                    onClick = onLoad,
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
                ) {
                    Icon(Icons.Rounded.Security, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("读取 ${recipient.preferredName} 的成员权限")
                }
            }
            return@LazyColumn
        }
        if (state.householdMembers.isEmpty()) {
            item { Text("当前家庭暂无已加入成员") }
        } else {
            items(state.householdMembers, key = { it.id }) { member ->
                val authority = state.careAuthorities.firstOrNull { it.memberId == member.id }
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.fillMaxWidth().padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Person, contentDescription = null)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(member.displayName, fontWeight = FontWeight.SemiBold)
                                Text(
                                    member.roleCodes
                                        .joinToString(" · ") { householdRoleLabel(it) }
                                        .ifBlank { "家庭成员" },
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(
                                authority?.status?.let(::statusLabel) ?: "未授权",
                                color = if (authority?.status == "ACTIVE") {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                            )
                        }
                        Text(
                            authority?.permissionSummary() ?: "尚未为这位成员配置长者级权限",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedButton(
                            onClick = { onEditAuthority(member) },
                            enabled = canManageMembers && member.status == "ACTIVE" && !state.busy,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        ) {
                            Icon(Icons.Rounded.Edit, contentDescription = null)
                            Spacer(Modifier.width(8.dp))
                            Text(if (authority == null) "配置权限" else "修改权限")
                        }
                        if (canManageMembers) {
                            val isSelf = member.userId == state.user?.id
                            if (isSelf) {
                                Text(
                                    "为防误操作，不能在此修改或移除自己的家庭成员身份。",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    OutlinedButton(
                                        onClick = { onEditRoles(member) },
                                        enabled = member.status == "ACTIVE" && !state.busy,
                                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                    ) {
                                        Icon(Icons.Rounded.Security, contentDescription = null)
                                        Spacer(Modifier.width(6.dp))
                                        Text("家庭角色")
                                    }
                                    OutlinedButton(
                                        onClick = { onRemoveMember(member) },
                                        enabled = member.status == "ACTIVE" && !state.busy,
                                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                        colors = ButtonDefaults.outlinedButtonColors(
                                            contentColor = MaterialTheme.colorScheme.error,
                                        ),
                                    ) {
                                        Icon(Icons.Rounded.Delete, contentDescription = null)
                                        Spacer(Modifier.width(6.dp))
                                        Text("移除成员")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun HouseholdMemberRoleDialog(
    member: HouseholdMemberView,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (Set<String>, String) -> Unit,
) {
    var selectedRoles by remember(member.id, member.version) {
        mutableStateOf(member.roleCodes.toSet())
    }
    // Deliberately not saveable and never normalized: this is one-request proof of presence.
    var currentPassword by remember(member.id, member.version) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = {
            currentPassword = ""
            onDismiss()
        },
        icon = { Icon(Icons.Rounded.Security, contentDescription = null) },
        title = { Text("${member.displayName} 的家庭角色") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "选择该成员的家庭角色。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                HOUSEHOLD_ROLE_OPTIONS.forEach { (code, label) ->
                    AuthorityToggle(label, code in selectedRoles) { checked ->
                        selectedRoles = if (checked) selectedRoles + code else selectedRoles - code
                    }
                }
                if (selectedRoles.isEmpty()) {
                    Text("请至少保留一个角色", color = MaterialTheme.colorScheme.error)
                }
                OutlinedTextField(
                    value = currentPassword,
                    onValueChange = { currentPassword = it },
                    label = { Text("当前账号密码") },
                    supportingText = { Text("用于确认身份") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val passwordForRequest = currentPassword
                    currentPassword = ""
                    onSave(selectedRoles, passwordForRequest)
                },
                enabled = !busy && selectedRoles.isNotEmpty() && currentPassword.isNotEmpty(),
            ) { Text(if (busy) "正在提交" else "确认角色变更") }
        },
        dismissButton = {
            TextButton(onClick = {
                currentPassword = ""
                onDismiss()
            }) { Text("取消") }
        },
    )
}

@Composable
private fun RemoveHouseholdMemberDialog(
    member: HouseholdMemberView,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    // Deliberately not saveable and never normalized: this is one-request proof of presence.
    var currentPassword by remember(member.id, member.version) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = {
            currentPassword = ""
            onDismiss()
        },
        icon = { Icon(Icons.Rounded.Delete, contentDescription = null) },
        title = { Text("移除 ${member.displayName}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "移除后，该成员将无法再访问此家庭。",
                )
                OutlinedTextField(
                    value = currentPassword,
                    onValueChange = { currentPassword = it },
                    label = { Text("当前账号密码") },
                    supportingText = { Text("用于确认身份") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val passwordForRequest = currentPassword
                    currentPassword = ""
                    onConfirm(passwordForRequest)
                },
                enabled = !busy && currentPassword.isNotEmpty(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                ),
            ) { Text(if (busy) "正在移除" else "确认移除") }
        },
        dismissButton = {
            TextButton(onClick = {
                currentPassword = ""
                onDismiss()
            }) { Text("取消") }
        },
    )
}

@Composable
private fun CareAuthorityEditorDialog(
    member: HouseholdMemberView,
    authority: CareAuthorityView?,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (CareAuthorityInput, String) -> Unit,
) {
    var relationshipLabel by remember(member.id, authority?.version) {
        mutableStateOf(authority?.relationshipLabel.orEmpty())
    }
    var accessLevel by remember(member.id, authority?.version) {
        mutableStateOf(authority?.accessLevel ?: "CUSTOM")
    }
    var canManageProfile by remember(member.id, authority?.version) {
        mutableStateOf(authority?.canManageProfile ?: false)
    }
    var canManageConsent by remember(member.id, authority?.version) {
        mutableStateOf(authority?.canManageConsent ?: false)
    }
    var canManageRoutine by remember(member.id, authority?.version) {
        mutableStateOf(authority?.canManageRoutine ?: false)
    }
    var canViewEvents by remember(member.id, authority?.version) {
        mutableStateOf(authority?.canViewEvents ?: false)
    }
    var canViewConversation by remember(member.id, authority?.version) {
        mutableStateOf(authority?.canViewConversation ?: false)
    }
    var canActivateDevice by remember(member.id, authority?.version) {
        mutableStateOf(authority?.canActivateDevice ?: false)
    }
    var canRemoteCall by remember(member.id, authority?.version) {
        mutableStateOf(authority?.canRemoteCall ?: false)
    }
    var receiveNotifications by remember(member.id, authority?.version) {
        mutableStateOf(authority?.receiveNotifications ?: false)
    }
    var active by remember(member.id, authority?.version) {
        mutableStateOf(authority?.status != "REVOKED")
    }
    var contactPriority by remember(member.id, authority?.version) {
        mutableStateOf(authority?.contactPriority?.toString().orEmpty())
    }
    // Deliberately not saveable: the password disappears with the dialog/configuration.
    var currentPassword by remember(member.id, authority?.version) { mutableStateOf("") }
    val parsedPriority = contactPriority.trim().takeIf(String::isNotBlank)?.toIntOrNull()
    val priorityValid = contactPriority.isBlank() || parsedPriority in 1..100

    AlertDialog(
        onDismissRequest = {
            currentPassword = ""
            onDismiss()
        },
        icon = { Icon(Icons.Rounded.VerifiedUser, contentDescription = null) },
        title = { Text("${member.displayName} 的照护权限") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    "为该成员选择可以使用的功能。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                OutlinedTextField(
                    value = relationshipLabel,
                    onValueChange = { relationshipLabel = it.take(50) },
                    label = { Text("与长者关系（可选）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = accessLevel,
                    onValueChange = { accessLevel = it.take(32).uppercase() },
                    label = { Text("权限级别") },
                    supportingText = { Text("例如 FULL 或 CUSTOM") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                AuthorityToggle("管理长者资料", canManageProfile) { canManageProfile = it }
                AuthorityToggle("管理隐私授权", canManageConsent) { canManageConsent = it }
                AuthorityToggle("管理提醒日程", canManageRoutine) { canManageRoutine = it }
                AuthorityToggle("查看照护事件", canViewEvents) { canViewEvents = it }
                AuthorityToggle("查看陪伴对话", canViewConversation) { canViewConversation = it }
                AuthorityToggle("激活陪伴设备", canActivateDevice) { canActivateDevice = it }
                AuthorityToggle("发起远程通话", canRemoteCall) { canRemoteCall = it }
                AuthorityToggle("接收通知", receiveNotifications) { receiveNotifications = it }
                AuthorityToggle("权限启用", active) { active = it }
                OutlinedTextField(
                    value = contactPriority,
                    onValueChange = { contactPriority = it.filter(Char::isDigit).take(3) },
                    label = { Text("通知优先级（1–100，可选）") },
                    isError = !priorityValid,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = currentPassword,
                    onValueChange = { currentPassword = it },
                    label = { Text("当前账号密码") },
                    supportingText = { Text("用于确认身份") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val passwordForRequest = currentPassword
                    currentPassword = ""
                    onSave(
                        CareAuthorityInput(
                            relationshipLabel = relationshipLabel.trim().takeIf(String::isNotBlank),
                            accessLevel = accessLevel.trim(),
                            canManageProfile = canManageProfile,
                            canManageConsent = canManageConsent,
                            canManageRoutine = canManageRoutine,
                            canViewEvents = canViewEvents,
                            canViewConversation = canViewConversation,
                            canActivateDevice = canActivateDevice,
                            canRemoteCall = canRemoteCall,
                            receiveNotifications = receiveNotifications,
                            contactPriority = parsedPriority,
                            status = if (active) "ACTIVE" else "REVOKED",
                            version = authority?.version,
                        ),
                        passwordForRequest,
                    )
                },
                enabled = !busy && currentPassword.isNotEmpty() && accessLevel.isNotBlank() && priorityValid,
            ) { Text(if (busy) "正在提交" else "确认更新") }
        },
        dismissButton = {
            TextButton(onClick = {
                currentPassword = ""
                onDismiss()
            }) { Text("取消") }
        },
    )
}

@Composable
private fun AuthorityToggle(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun RevokeBindingDialog(
    binding: CompanionBindingView,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String?, String) -> Unit,
) {
    var reasonCode by remember(binding.id) { mutableStateOf("FAMILY_REQUESTED_UNBIND") }
    // Deliberately not saveable: the password disappears with the dialog/configuration.
    var currentPassword by remember(binding.id) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = {
            currentPassword = ""
            onDismiss()
        },
        icon = { Icon(Icons.Rounded.Delete, contentDescription = null) },
        title = { Text("解绑 ${binding.displayName}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("解绑后，此设备需要重新激活才能使用。")
                OutlinedTextField(
                    value = reasonCode,
                    onValueChange = { reasonCode = it.take(64) },
                    label = { Text("原因代码（可选）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = currentPassword,
                    onValueChange = { currentPassword = it },
                    label = { Text("当前账号密码") },
                    supportingText = { Text("用于确认身份") },
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val passwordForRequest = currentPassword
                    currentPassword = ""
                    onConfirm(reasonCode.trim().takeIf(String::isNotBlank), passwordForRequest)
                },
                enabled = !busy && currentPassword.isNotEmpty(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                ),
            ) { Text(if (busy) "正在解绑" else "确认解绑") }
        },
        dismissButton = {
            TextButton(onClick = {
                currentPassword = ""
                onDismiss()
            }) { Text("取消") }
        },
    )
}

private fun CareAuthorityView.permissionSummary(): String {
    val permissions = buildList {
        if (canManageProfile) add("资料")
        if (canManageConsent) add("授权")
        if (canManageRoutine) add("日程")
        if (canViewEvents) add("事件")
        if (canViewConversation) add("对话")
        if (canActivateDevice) add("设备激活")
        if (canRemoteCall) add("远程通话")
        if (receiveNotifications) add("通知")
    }
    return buildString {
        append(relationshipLabel?.let { "$it · " }.orEmpty())
        append(accessLevelLabel(accessLevel))
        append(" · ")
        append(permissions.joinToString("、").ifBlank { "无功能权限" })
    }
}

@Composable
private fun MemoriesSection(
    state: LighthouseUiState,
    onAdd: () -> Unit,
    onEdit: (MemoryView) -> Unit,
    onDelete: (MemoryView) -> Unit,
) {
    val selectedRecipient = state.selectedRecipient
    if (selectedRecipient == null) {
        ResourceEmpty(Icons.AutoMirrored.Rounded.MenuBook, "尚未选择陪伴对象", "请先创建并选择一位长者。")
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            ResourceToolbar(
                title = "${selectedRecipient.preferredName}的记忆档案",
                subtitle = "记录本人或家属已确认的生活信息。",
                actionLabel = "新增记忆",
                onAction = onAdd,
            )
        }
        if (state.memories.isEmpty()) {
            item {
                InlineEmpty("还没有记忆", "点击新增开始记录。")
            }
        } else {
            items(state.memories, key = { it.id }) { memory ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(
                        Modifier.fillMaxWidth().padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            StatusLabel(memoryKindLabel(memory.kind))
                            Spacer(Modifier.width(8.dp))
                            StatusLabel(verificationLabel(memory.verificationStatus))
                            Spacer(Modifier.weight(1f))
                            Text(
                                "第 ${memory.currentRevision.revisionNo} 版",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(memory.title, style = MaterialTheme.typography.titleLarge)
                        Text(
                            memory.currentRevision.content,
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Text(
                            sensitivityLabel(memory.sensitivity),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End,
                        ) {
                            TextButton(
                                onClick = { onEdit(memory) },
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) {
                                Icon(Icons.Rounded.Edit, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("编辑")
                            }
                            TextButton(
                                onClick = { onDelete(memory) },
                                colors = ButtonDefaults.textButtonColors(
                                    contentColor = MaterialTheme.colorScheme.error,
                                ),
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) {
                                Icon(Icons.Rounded.Delete, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("删除")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CareSection(
    state: LighthouseUiState,
    onAddRoutine: () -> Unit,
    onEditRoutine: (RoutineView) -> Unit,
    onDeleteRoutine: (RoutineView) -> Unit,
    onVerifyOccurrence: (OccurrenceView, Boolean) -> Unit,
    onClaimTask: (FamilyTaskView) -> Unit,
    onFinishTask: (FamilyTaskView, Boolean) -> Unit,
) {
    if (state.selectedRecipient == null) {
        ResourceEmpty(Icons.Rounded.CalendarMonth, "尚未选择陪伴对象", "日程、实例、事件和待办都归属于具体长者。")
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            ResourceToolbar(
                title = "日程与家庭待办",
                subtitle = "管理提醒和家庭待办。",
                actionLabel = "新增日程",
                onAction = onAddRoutine,
            )
        }
        item { SectionHeading("日程规则", Icons.Rounded.Schedule) }
        if (state.routines.isEmpty()) {
            item { InlineEmpty("暂无日程", "点击新增开始安排。") }
        } else {
            items(state.routines, key = { "routine-${it.id}" }) { routine ->
                RoutineCard(routine, onEditRoutine, onDeleteRoutine)
            }
        }
        item { SectionHeading("需要家属处理", Icons.AutoMirrored.Rounded.Assignment) }
        if (state.familyTasks.isEmpty()) {
            item { InlineEmpty("暂无家庭待办", "当前没有需要处理的事项。") }
        } else {
            items(state.familyTasks, key = { "task-${it.id}" }) { task ->
                TaskCard(
                    task = task,
                    sourceEvent = state.careEvents.firstOrNull { it.id == task.sourceEventId },
                    onClaim = onClaimTask,
                    onFinish = onFinishTask,
                )
            }
        }
        item { SectionHeading("近期日程实例", Icons.AutoMirrored.Rounded.EventNote) }
        if (state.occurrences.isEmpty()) {
            item { InlineEmpty("暂无近期实例", "暂无提醒记录。") }
        } else {
            items(state.occurrences, key = { "occurrence-${it.id}" }) { occurrence ->
                OccurrenceCard(occurrence, onVerifyOccurrence)
            }
        }
        item { SectionHeading("照护事件", Icons.Rounded.TaskAlt) }
        if (state.careEvents.isEmpty()) {
            item { InlineEmpty("暂无事件", "暂无动态。") }
        } else {
            items(state.careEvents, key = { "event-${it.id}" }) { event ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Row(
                        Modifier.fillMaxWidth().padding(16.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(event.title, fontWeight = FontWeight.SemiBold)
                            Text(event.summary, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(
                                "${formatInstant(event.occurredAt)} · ${event.sourceType} · ${event.type}",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        StatusLabel(severityLabel(event.severity))
                    }
                }
            }
        }
    }
}

@Composable
private fun PrivacySection(
    state: LighthouseUiState,
    onDecide: (ConsentScopeDefinition, Boolean) -> Unit,
) {
    if (state.selectedRecipient == null) {
        ResourceEmpty(Icons.Rounded.PrivacyTip, "尚未选择陪伴对象", "请先选择要管理的长者。")
        return
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp, 16.dp, 16.dp, 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            ActionNotice(
                icon = Icons.Rounded.VerifiedUser,
                title = "授权管理",
                body = "选择可以使用的陪伴功能。",
            )
        }
        items(ConsentCatalog.entries, key = { it.scope }) { definition ->
            val consent = state.consents.firstOrNull { it.scope == definition.scope }
            val granted = consent?.granted == true
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(
                    Modifier.fillMaxWidth().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            if (definition.sensitive) Icons.Rounded.Lock else Icons.Rounded.PrivacyTip,
                            contentDescription = null,
                            tint = if (definition.sensitive) {
                                MaterialTheme.colorScheme.error
                            } else {
                                MaterialTheme.colorScheme.primary
                            },
                        )
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(definition.title, style = MaterialTheme.typography.titleMedium)
                            Text(definition.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Text(definition.detail, style = MaterialTheme.typography.bodyMedium)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        StatusLabel(
                            if (granted) "已授权" else if (consent?.decision == "REVOKED") "已撤回" else "未授权",
                        )
                        Spacer(Modifier.weight(1f))
                        if (granted) {
                            OutlinedButton(
                                onClick = { onDecide(definition, false) },
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.error,
                                ),
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) { Text("撤回") }
                        } else {
                            Button(
                                onClick = { onDecide(definition, true) },
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) { Text("查看并授权") }
                        }
                    }
                    consent?.lastEvent?.let { event ->
                        Text(
                            "最近决定：${formatInstant(event.occurredAt)} · 文档 v${event.documentVersion.version}",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun RoutineCard(
    routine: RoutineView,
    onEdit: (RoutineView) -> Unit,
    onDelete: (RoutineView) -> Unit,
) {
    val schedule = routine.schedules.firstOrNull()
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusLabel(routineTypeLabel(routine.type))
                Spacer(Modifier.width(8.dp))
                Text(
                    schedule?.localTimeMinutes?.let(::formatMinutes) ?: "未排期",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.weight(1f))
                StatusLabel(statusLabel(routine.status))
            }
            Text(routine.title, style = MaterialTheme.typography.titleLarge)
            Text(routine.instructions, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                routine.confirmationQuestion,
                style = MaterialTheme.typography.bodyMedium,
            )
            schedule?.let {
                Text(
                    "${weekdayMaskLabel(it.weekdayMask)} · ${it.timezone} · 提前 ${it.familyNoticeMinutes} 分钟通知家属",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(
                    onClick = { onEdit(routine) },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Rounded.Edit, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("编辑")
                }
                TextButton(
                    onClick = { onDelete(routine) },
                    colors = ButtonDefaults.textButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                    modifier = Modifier.heightIn(min = 48.dp),
                ) {
                    Icon(Icons.Rounded.Delete, contentDescription = null)
                    Spacer(Modifier.width(6.dp))
                    Text("删除")
                }
            }
        }
    }
}

@Composable
private fun TaskCard(
    task: FamilyTaskView,
    sourceEvent: CareEventView?,
    onClaim: (FamilyTaskView) -> Unit,
    onFinish: (FamilyTaskView, Boolean) -> Unit,
) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusLabel(priorityLabel(task.priority))
                Spacer(Modifier.width(8.dp))
                StatusLabel(taskStatusLabel(task.status))
            }
            Text(sourceEvent?.title ?: "家庭协同事项", style = MaterialTheme.typography.titleMedium)
            Text(
                sourceEvent?.summary ?: "来源事件：${task.sourceEventId}",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            task.dueAt?.let {
                Text(
                    "截止：${formatInstant(it)}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (task.status in setOf("OPEN", "CLAIMED")) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (task.status == "OPEN") {
                        OutlinedButton(
                            onClick = { onClaim(task) },
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                        ) { Text("领取") }
                    }
                    Button(
                        onClick = { onFinish(task, true) },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    ) { Text("已处理") }
                    TextButton(
                        onClick = { onFinish(task, false) },
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text("忽略") }
                }
            } else {
                task.resolutionCode?.let {
                    Text(
                        "处理结果：$it${task.resolutionNote?.let { note -> " · $note" }.orEmpty()}",
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
        }
    }
}

@Composable
private fun OccurrenceCard(
    occurrence: OccurrenceView,
    onVerify: (OccurrenceView, Boolean) -> Unit,
) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                StatusLabel(occurrenceStatusLabel(occurrence.status))
                Spacer(Modifier.weight(1f))
                Text(
                    formatInstant(occurrence.scheduledAtUtc),
                    style = MaterialTheme.typography.labelLarge,
                )
            }
            Text(occurrence.routineTitle, style = MaterialTheme.typography.titleMedium)
            Text(occurrence.instructions, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                "家属录入的提醒内容",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (occurrence.status == "NEEDS_FAMILY_REVIEW") {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(
                        onClick = { onVerify(occurrence, true) },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    ) {
                        Icon(Icons.Rounded.CheckCircle, contentDescription = null)
                        Spacer(Modifier.width(6.dp))
                        Text("核验已完成")
                    }
                    OutlinedButton(
                        onClick = { onVerify(occurrence, false) },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                    ) { Text("核验未完成") }
                }
            }
        }
    }
}

@Composable
private fun ResourceToolbar(
    title: String,
    subtitle: String,
    actionLabel: String,
    onAction: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            title,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )
        Text(subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(
            onClick = onAction,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
        ) {
            Icon(Icons.Rounded.Add, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text(actionLabel)
        }
    }
}

@Composable
private fun ActionNotice(
    icon: ImageVector,
    title: String,
    body: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
        ),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null)
                Spacer(Modifier.width(10.dp))
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            }
            Text(body, style = MaterialTheme.typography.bodyLarge)
            if (actionLabel != null && onAction != null) {
                Button(
                    onClick = onAction,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                ) {
                    Text(actionLabel)
                }
            }
        }
    }
}

@Composable
private fun SetupCard(
    icon: ImageVector,
    title: String,
    body: String,
    actionLabel: String,
    onAction: () -> Unit,
) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(42.dp))
            Text(title, style = MaterialTheme.typography.headlineSmall, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            Text(
                body,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
            Button(
                onClick = onAction,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
            ) {
                Icon(Icons.Rounded.Add, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(actionLabel)
            }
        }
    }
}

@Composable
private fun MetricCard(label: String, value: String, modifier: Modifier = Modifier) {
    Card(modifier) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.labelLarge)
            Text(value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun SectionHeading(title: String, icon: ImageVector) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.semantics { heading() },
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(8.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun StatusLabel(label: String) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        shape = RoundedCornerShape(999.dp),
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
        )
    }
}

@Composable
private fun InlineEmpty(title: String, body: String) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(
            Modifier.fillMaxWidth().padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(body, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ResourceEmpty(icon: ImageVector, title: String, body: String) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(44.dp))
            Text(title, style = MaterialTheme.typography.titleLarge)
            Text(
                body,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun HouseholdEditorDialog(
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (String, String) -> Unit,
) {
    var name by rememberSaveable { mutableStateOf("") }
    var timezone by rememberSaveable { mutableStateOf(localTimezone()) }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Rounded.Home, contentDescription = null) },
        title = { Text("创建家庭") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(100) },
                    label = { Text("家庭名称") },
                    supportingText = { Text("例如：林阿姨的家") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = timezone,
                    onValueChange = { timezone = it.take(64) },
                    label = { Text("时区") },
                    supportingText = { Text("IANA 时区，例如 Asia/Shanghai") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(name, timezone) },
                enabled = !busy && name.isNotBlank() && timezone.isNotBlank(),
            ) { Text(if (busy) "正在创建" else "创建家庭") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun RecipientEditorDialog(
    busy: Boolean,
    defaultTimezone: String,
    onDismiss: () -> Unit,
    onSave: (CareRecipientInput) -> Unit,
) {
    var name by rememberSaveable { mutableStateOf("") }
    var preferredName by rememberSaveable { mutableStateOf("") }
    var birthDate by rememberSaveable { mutableStateOf("") }
    var timezone by rememberSaveable(defaultTimezone) { mutableStateOf(defaultTimezone) }
    var homeLabel by rememberSaveable { mutableStateOf("") }
    val birthDateValid = birthDate.isBlank() || runCatching { LocalDate.parse(birthDate) }.isSuccess
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Rounded.Person, contentDescription = null) },
        title = { Text("添加陪伴对象") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(100) },
                    label = { Text("姓名") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = preferredName,
                    onValueChange = { preferredName = it.take(100) },
                    label = { Text("希望如何称呼（可选）") },
                    supportingText = { Text("例如：林阿姨") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = birthDate,
                    onValueChange = { birthDate = it.take(10) },
                    label = { Text("出生日期（可选）") },
                    supportingText = {
                        Text(if (birthDateValid) "格式：YYYY-MM-DD" else "请输入有效日期，例如 1950-06-01")
                    },
                    isError = !birthDateValid,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = homeLabel,
                    onValueChange = { homeLabel = it.take(100) },
                    label = { Text("家庭位置说明（可选）") },
                    supportingText = { Text("例如：杭州 · 家中客厅") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = timezone,
                    onValueChange = { timezone = it.take(64) },
                    label = { Text("时区") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(
                        CareRecipientInput(
                            name = name,
                            preferredName = preferredName.trim().takeIf(String::isNotBlank),
                            birthDate = birthDate.trim().takeIf(String::isNotBlank),
                            timezone = timezone,
                            homeLabel = homeLabel.trim().takeIf(String::isNotBlank),
                        ),
                    )
                },
                enabled = !busy && name.isNotBlank() && timezone.isNotBlank() && birthDateValid,
            ) { Text(if (busy) "正在添加" else "添加长者") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun MemoryEditorDialog(
    memory: MemoryView?,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (MemoryInput) -> Unit,
) {
    var kind by remember(memory?.id) { mutableStateOf(memory?.kind ?: "PREFERENCE") }
    var title by remember(memory?.id) { mutableStateOf(memory?.title.orEmpty()) }
    var content by remember(memory?.id) { mutableStateOf(memory?.currentRevision?.content.orEmpty()) }
    var sensitivity by remember(memory?.id) { mutableStateOf(memory?.sensitivity ?: "SENSITIVE") }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.AutoMirrored.Rounded.MenuBook, contentDescription = null) },
        title = { Text(if (memory == null) "新增可核验记忆" else "更新记忆并生成新修订") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("类型", style = MaterialTheme.typography.labelLarge)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(MEMORY_KINDS) { item ->
                        FilterChip(
                            selected = kind == item.first,
                            onClick = { kind = item.first },
                            label = { Text(item.second) },
                            modifier = Modifier.height(48.dp),
                        )
                    }
                }
                Text("敏感等级", style = MaterialTheme.typography.labelLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = sensitivity == "SENSITIVE",
                        onClick = { sensitivity = "SENSITIVE" },
                        label = { Text("敏感信息") },
                        modifier = Modifier.height(48.dp),
                    )
                    FilterChip(
                        selected = sensitivity == "HOUSEHOLD",
                        onClick = { sensitivity = "HOUSEHOLD" },
                        label = { Text("家庭内信息") },
                        modifier = Modifier.height(48.dp),
                    )
                }
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it.take(200) },
                    label = { Text("标题") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = content,
                    onValueChange = { content = it.take(20_000) },
                    label = { Text("内容") },
                    supportingText = { Text("仅录入本人或家属确认的信息") },
                    minLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(
                        MemoryInput(
                            kind = kind,
                            title = title,
                            content = content,
                            sensitivity = sensitivity,
                            verificationStatus = memory?.verificationStatus ?: "FAMILY_REPORTED",
                        ),
                    )
                },
                enabled = !busy && title.isNotBlank() && content.isNotBlank(),
            ) { Text(if (busy) "正在保存" else if (memory == null) "保存记忆" else "保存新修订") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun RoutineEditorDialog(
    routine: RoutineView?,
    defaultTimezone: String,
    busy: Boolean,
    onDismiss: () -> Unit,
    onSave: (RoutineInput) -> Unit,
) {
    val schedule = routine?.schedules?.firstOrNull()
    var type by remember(routine?.id) { mutableStateOf(routine?.type ?: "OTHER") }
    var title by remember(routine?.id) { mutableStateOf(routine?.title.orEmpty()) }
    var instructions by remember(routine?.id) { mutableStateOf(routine?.instructions.orEmpty()) }
    var question by remember(routine?.id) { mutableStateOf(routine?.confirmationQuestion.orEmpty()) }
    var timezone by remember(routine?.id, defaultTimezone) {
        mutableStateOf(schedule?.timezone ?: defaultTimezone)
    }
    var timeText by remember(routine?.id) {
        mutableStateOf(formatMinutes(schedule?.localTimeMinutes ?: 510))
    }
    var weekdayMask by remember(routine?.id) { mutableIntStateOf(schedule?.weekdayMask ?: 127) }
    var startDate by remember(routine?.id) {
        mutableStateOf(schedule?.startDate ?: LocalDate.now().toString())
    }
    var endDate by remember(routine?.id) { mutableStateOf(schedule?.endDate.orEmpty()) }
    var graceMinutes by remember(routine?.id) {
        mutableStateOf((schedule?.graceMinutes ?: 5).toString())
    }
    var noticeMinutes by remember(routine?.id) {
        mutableStateOf((schedule?.familyNoticeMinutes ?: 15).toString())
    }
    val parsedTime = parseTime(timeText)
    val grace = graceMinutes.toIntOrNull()
    val notice = noticeMinutes.toIntOrNull()
    val datesValid = runCatching { LocalDate.parse(startDate) }.isSuccess &&
        (endDate.isBlank() || runCatching { LocalDate.parse(endDate) }.isSuccess)
    val valid = title.isNotBlank() && instructions.isNotBlank() && question.isNotBlank() &&
        timezone.isNotBlank() && parsedTime != null && weekdayMask != 0 && datesValid &&
        grace != null && grace in 0..1440 && notice != null && notice in 0..10080

    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Rounded.CalendarMonth, contentDescription = null) },
        title = { Text(if (routine == null) "新增确定性日程" else "编辑日程") },
        text = {
            Column(
                Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text("日程类型", style = MaterialTheme.typography.labelLarge)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(ROUTINE_TYPES) { item ->
                        FilterChip(
                            selected = type == item.first,
                            onClick = { type = item.first },
                            label = { Text(item.second) },
                            modifier = Modifier.height(48.dp),
                        )
                    }
                }
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it.take(200) },
                    label = { Text("标题") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = instructions,
                    onValueChange = { instructions = it.take(4_000) },
                    label = { Text("家属录入的提醒内容") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = question,
                    onValueChange = { question = it.take(1_000) },
                    label = { Text("确认问题") },
                    supportingText = { Text("例如：您已经按家属安排完成了吗？") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = timeText,
                    onValueChange = { timeText = it.take(5) },
                    label = { Text("提醒时间") },
                    supportingText = { Text(if (parsedTime != null) "24 小时制 HH:mm" else "请输入有效时间，例如 08:30") },
                    isError = parsedTime == null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("重复日期", style = MaterialTheme.typography.labelLarge)
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(WEEKDAYS) { day ->
                        val selected = weekdayMask and day.first != 0
                        FilterChip(
                            selected = selected,
                            onClick = {
                                weekdayMask = if (selected) {
                                    weekdayMask and day.first.inv()
                                } else {
                                    weekdayMask or day.first
                                }
                            },
                            label = { Text(day.second) },
                            modifier = Modifier.height(48.dp),
                        )
                    }
                }
                OutlinedTextField(
                    value = startDate,
                    onValueChange = { startDate = it.take(10) },
                    label = { Text("开始日期") },
                    supportingText = { Text("YYYY-MM-DD") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = endDate,
                    onValueChange = { endDate = it.take(10) },
                    label = { Text("结束日期（可选）") },
                    supportingText = { Text("留空表示长期有效") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = timezone,
                    onValueChange = { timezone = it.take(64) },
                    label = { Text("时区") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = graceMinutes,
                    onValueChange = { graceMinutes = it.filter(Char::isDigit).take(4) },
                    label = { Text("确认宽限分钟") },
                    supportingText = { Text("0–1440 分钟") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = noticeMinutes,
                    onValueChange = { noticeMinutes = it.filter(Char::isDigit).take(5) },
                    label = { Text("提前通知家属分钟") },
                    supportingText = { Text("0–10080 分钟") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(
                        RoutineInput(
                            type = type,
                            medicationId = routine?.medicationId,
                            title = title,
                            instructions = instructions,
                            confirmationQuestion = question,
                            timezone = timezone,
                            localTimeMinutes = requireNotNull(parsedTime),
                            weekdayMask = weekdayMask,
                            startDate = startDate,
                            endDate = endDate.trim().takeIf(String::isNotBlank),
                            graceMinutes = requireNotNull(grace),
                            familyNoticeMinutes = requireNotNull(notice),
                        ),
                    )
                },
                enabled = !busy && valid,
            ) { Text(if (busy) "正在保存" else "保存日程") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun ConfirmDeleteDialog(
    title: String,
    body: String,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Rounded.Delete,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.error,
            )
        },
        title = { Text(title) },
        text = { Text(body) },
        confirmButton = {
            Button(
                onClick = onConfirm,
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.error,
                    contentColor = MaterialTheme.colorScheme.onError,
                ),
            ) { Text(if (busy) "正在删除" else "确认删除") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun OccurrenceDecisionDialog(
    decision: OccurrenceDecision,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String?) -> Unit,
) {
    var note by remember(decision.occurrence.id, decision.verified) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Rounded.TaskAlt, contentDescription = null) },
        title = { Text(if (decision.verified) "核验为已完成" else "核验为未完成") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    if (decision.verified) {
                        "确认“${decision.occurrence.routineTitle}”已经完成吗？"
                    } else {
                        "确认记录为未完成吗？此操作会关闭本次日程实例。"
                    },
                )
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it.take(1_000) },
                    label = { Text("核验备注（可选）") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(note.trim().takeIf(String::isNotBlank)) },
                enabled = !busy,
            ) { Text(if (busy) "正在提交" else "确认核验") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun TaskDecisionDialog(
    decision: TaskDecision,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (String?) -> Unit,
) {
    var note by remember(decision.task.id, decision.resolve) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.AutoMirrored.Rounded.Assignment, contentDescription = null) },
        title = { Text(if (decision.resolve) "完成家庭待办" else "忽略家庭待办") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    if (decision.resolve) {
                        "将标记为已处理。"
                    } else {
                        "将标记为无需处理，请确认该事项确实无需处理。"
                    },
                )
                OutlinedTextField(
                    value = note,
                    onValueChange = { note = it.take(2_000) },
                    label = { Text("处理备注（可选）") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(note.trim().takeIf(String::isNotBlank)) },
                enabled = !busy,
            ) { Text(if (busy) "正在提交" else if (decision.resolve) "确认已处理" else "确认忽略") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

@Composable
private fun ConsentDecisionDialog(
    decision: ConsentDecision,
    busy: Boolean,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                if (decision.definition.sensitive) Icons.Rounded.Lock else Icons.Rounded.PrivacyTip,
                contentDescription = null,
            )
        },
        title = {
            Text(if (decision.grant) "授权：${decision.definition.title}" else "撤回：${decision.definition.title}")
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(decision.definition.description)
                Text(decision.definition.detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    if (decision.grant) {
                        "授权后立即生效。"
                    } else {
                        "撤回后将停止使用此功能。"
                    },
                    fontWeight = FontWeight.SemiBold,
                )
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                enabled = !busy,
                colors = if (decision.grant) {
                    ButtonDefaults.buttonColors()
                } else {
                    ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    )
                },
            ) { Text(if (busy) "正在提交" else if (decision.grant) "明确授权" else "确认撤回") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } },
    )
}

private val MEMORY_KINDS = listOf(
    "PERSON" to "人物",
    "PREFERENCE" to "偏好",
    "PLACE" to "位置",
    "STORY" to "生活故事",
    "ROUTINE" to "日常习惯",
)

private val ROUTINE_TYPES = listOf(
    "MEDICATION" to "用药",
    "MEAL" to "用餐",
    "HYDRATION" to "饮水",
    "ACTIVITY" to "活动",
    "APPOINTMENT" to "约定",
    "OTHER" to "其他",
)

private val HOUSEHOLD_ROLE_OPTIONS = listOf(
    "OWNER" to "家庭所有者",
    "CAREGIVER" to "照护成员",
    "VIEWER" to "只读成员",
)

/** Bit 0 is Sunday and bit 6 is Saturday, matching the server contract. */
private val WEEKDAYS = listOf(
    1 to "日",
    2 to "一",
    4 to "二",
    8 to "三",
    16 to "四",
    32 to "五",
    64 to "六",
)

private fun memoryKindLabel(value: String) = MEMORY_KINDS.toMap()[value] ?: value

private fun routineTypeLabel(value: String) = ROUTINE_TYPES.toMap()[value] ?: value

private fun householdRoleLabel(value: String) =
    HOUSEHOLD_ROLE_OPTIONS.toMap()[value] ?: "家庭成员"

private fun accessLevelLabel(value: String) = when (value) {
    "FULL" -> "完整权限"
    "CUSTOM" -> "自定义权限"
    "LIMITED" -> "受限权限"
    else -> "已配置权限"
}

private fun sensitivityLabel(value: String) = when (value) {
    "SENSITIVE" -> "敏感信息"
    "HOUSEHOLD" -> "家庭内信息"
    else -> value
}

private fun verificationLabel(value: String) = when (value) {
    "FAMILY_REPORTED" -> "家属录入"
    "FAMILY_VERIFIED" -> "家属已核验"
    "UNVERIFIED" -> "未核验"
    else -> value
}

private fun occurrenceStatusLabel(value: String) = when (value) {
    "DUE" -> "待提醒"
    "AWAITING_CONFIRMATION" -> "等待本人确认"
    "NEEDS_FAMILY_REVIEW" -> "需要家属核验"
    "CONFIRMED" -> "已确认"
    "EXPIRED" -> "未完成/已关闭"
    else -> value
}

private fun taskStatusLabel(value: String) = when (value) {
    "OPEN" -> "待领取"
    "CLAIMED" -> "处理中"
    "RESOLVED" -> "已处理"
    "DISMISSED" -> "已忽略"
    else -> value
}

private fun priorityLabel(value: String) = when (value) {
    "URGENT" -> "紧急"
    "HIGH" -> "高优先级"
    "NORMAL" -> "普通"
    "LOW" -> "低优先级"
    else -> value
}

private fun severityLabel(value: String) = when (value) {
    "ATTENTION" -> "需关注"
    "WARNING" -> "警告"
    "CRITICAL" -> "紧急"
    "INFO" -> "信息"
    else -> value
}

private fun statusLabel(value: String) = when (value) {
    "ACTIVE" -> "已启用"
    "REVOKED" -> "已撤销"
    "DELETED" -> "已删除"
    else -> value
}

private fun weekdayMaskLabel(mask: Int): String =
    if (mask == 127) "每天" else WEEKDAYS.filter { mask and it.first != 0 }
        .joinToString("、") { "周${it.second}" }

private fun formatMinutes(minutes: Int): String =
    "%02d:%02d".format(minutes / 60, minutes % 60)

private fun parseTime(value: String): Int? {
    val parts = value.split(':')
    if (parts.size != 2) return null
    val hour = parts[0].toIntOrNull() ?: return null
    val minute = parts[1].toIntOrNull() ?: return null
    if (hour !in 0..23 || minute !in 0..59) return null
    return hour * 60 + minute
}

private fun formatInstant(value: String): String = runCatching {
    INSTANT_FORMATTER.format(Instant.parse(value))
}.getOrDefault(value)

private fun localTimezone(): String = TimeZone.getDefault().id.takeIf(String::isNotBlank)
    ?: "Asia/Shanghai"

private fun timezoneDisplayLabel(value: String): String = when (value) {
    "Asia/Shanghai", "Asia/Chongqing", "Asia/Harbin", "PRC" -> "北京时间"
    "Asia/Hong_Kong" -> "香港时间"
    "Asia/Taipei" -> "台北时间"
    "Asia/Tokyo" -> "日本时间"
    "UTC", "Etc/UTC", "GMT" -> "协调世界时"
    else -> "当地时间"
}

private val INSTANT_FORMATTER = DateTimeFormatter.ofPattern("MM-dd HH:mm")
    .withZone(ZoneId.systemDefault())
