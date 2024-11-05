const axios = require('axios');
const mysql = require('mysql2/promise');
const cron = require('node-cron');

// Configuração da conexão com o banco de dados
const dbConfig = {
    host: '10.172.0.24',
    user: 'root',
    password: 'Int@Dc5382',
    database: 'panel_services'
};

// Mapeamento dos status
const statusMap = {
    '1': 'Novo',
    '2': 'Em Progresso',
    '3': 'Concluído',
    '4': 'Cancelado',
    '5': 'Aguardando',
};

// Função com retry para pegar os detalhes dos usuários pelo ID
const getUserDetails = async (userIds, retryCount = 3) => {
    if (userIds.length === 0) {
        console.warn('Nenhum ID de usuário para buscar.');
        return {}; // Retorna um objeto vazio se não houver IDs
    }

    const url = 'https://interatell.bitrix24.com.br/rest/189/4mqlbd71zd2dfj45/user.get.json';

    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            const response = await axios.post(url, {
                filter: { 'ID': userIds },
                select: ['ID', 'NAME', 'LAST_NAME']
            });

            const userMap = {};
            if (response.data.result) {
                response.data.result.forEach(user => {
                    userMap[user.ID] = `${user.NAME} ${user.LAST_NAME}`;
                });
            } else {
                console.warn('Resposta inesperada da API de usuários:', response.data);
            }

            return userMap;
        } catch (error) {
            console.error(`Erro ao buscar detalhes dos usuários (tentativa ${attempt}):`, error.message);
            if (attempt === retryCount || !error.response || error.response.status !== 503) {
                return {};
            }
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        }
    }
};

// Função com retry para buscar o título da empresa
async function fetchCompanyTitle(companyId, retryCount = 3) {
    const url = `https://interatell.bitrix24.com.br/rest/189/06s8ccs4p008cy4v/crm.company.get.json`;

    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            const response = await axios.get(url, { params: { id: companyId } });
            if (response.data.result && response.data.result.TITLE) {
                return response.data.result.TITLE;
            } else {
                console.warn(`Resposta inesperada da API da empresa para ID ${companyId}:`, response.data);
                return 'N/A';
            }
        } catch (error) {
            console.error(`Erro ao buscar título da empresa (tentativa ${attempt}):`, error.message);
            if (attempt === retryCount || !error.response || error.response.status !== 503) {
                return 'Erro ao buscar empresa';
            }
            await new Promise(resolve => setTimeout(resolve, attempt * 2000));
        }
    }
}

// Função para extrair tarefas com paralelismo e retry
async function fetchTasks() {
    let allTasks = [];
    let totalTasks = 0;
    let start = 0;
    const limit = 50;

    try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute('TRUNCATE TABLE panel_auto');
        console.log('Tabela panel_auto truncada com sucesso.');

        do {
            const response = await axios.get('https://interatell.bitrix24.com.br/rest/189/06s8ccs4p008cy4v/tasks.task.list.json', {
                params: { select: [ /* Lista de campos */ ], start }
            });

            if (!response.data.result || !response.data.result.tasks) {
                console.warn('Resposta inesperada da API de tarefas:', response.data);
                break;
            }

            allTasks = allTasks.concat(response.data.result.tasks);
            totalTasks = response.data.total;

            const userIds = new Set();
            response.data.result.tasks.forEach(task => {
                userIds.add(task.responsibleId);
                userIds.add(task.createdBy);
                userIds.add(task.changedBy);
                userIds.add(task.closedBy);
            });

            const userMap = await getUserDetails(Array.from(userIds));

            const taskPromises = response.data.result.tasks.map(async (task, index) => {
                // 1. Verificação de campos obrigatórios
                if (!task.id || !task.title) {
                    console.warn(`Task ID ou título ausente. Task ignorada: ${task.id}`);
                    return;
                }

                // 2. Verificação de formato de `ufCrmTask`
                if (typeof task.ufCrmTask !== 'string') {
                    console.warn(`Formato inválido de ufCrmTask para a task ID ${task.id}`);
                    return;
                }

                // 3. Validação de datas
                const createdDate = new Date(task.createdDate);
                const changedDate = new Date(task.changedDate);
                const closedDate = new Date(task.closedDate);

                if (isNaN(createdDate.getTime()) || isNaN(changedDate.getTime()) || (task.closedDate && isNaN(closedDate.getTime()))) {
                    console.warn(`Data inválida encontrada na task ID ${task.id}`);
                    return;
                }

                // 4. Verificação do tamanho dos campos
                if (task.title.length > 255) {
                    console.warn(`Título muito longo para a task ID ${task.id}`);
                    return;
                }

                const { negocio, pmo, contratos, servicos, empresa } = await handleCustomFields(task);

                // 5. Verificação de valores válidos para inserção
                if (pmo === 'N/A' && contratos === 'N/A' && servicos === 'N/A' && empresa === 'N/A') {
                    console.warn(`Dados inválidos para a task ID ${task.id}. Não será realizada a inserção.`);
                    return;
                }

                const values = [
                    parseInt(task.id, 10),
                    task.title,
                    task.description || null,
                    empresa || null, 
                    pmo || null, 
                    contratos || null,
                    servicos || null,
                    null,
                    statusMap[task.status] || null,
                    parseInt(task.timeSpentInLogs, 10) || 0,
                    createdDate.toISOString(),
                    changedDate.toISOString(),
                    closedDate ? closedDate.toISOString() : null,
                    userMap[task.createdBy] || 'Desconhecido',
                    userMap[task.changedBy] || 'Desconhecido',
                    userMap[task.responsibleId] || 'Desconhecido',
                    task.commentsCount || 'N/A'
                ];

                const sql = `
                    INSERT INTO panel_auto (
                        Id_Tarefa, Nome, Descricao, Empresa, PMO, Contratos, Servicos, Categoria, Status,
                        Tempo_Gasto, Data_Criacao, Data_Modificacao, Data_Conclusao, Criado_Por,
                        Alterado_Por, Responsavel, Comentario_Encerramento
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                try {
                    await connection.execute(sql, values);
                    console.log(`Task ID ${task.id} inserida com sucesso.`);
                } catch (insertError) {
                    console.error(`Erro ao inserir a task ID ${task.id}:`, insertError.message);
                }
            });

            await Promise.all(taskPromises);
            start += limit;
            await new Promise(resolve => setTimeout(resolve, 1000));

        } while (start < totalTasks);

        console.log(`\nTotal de tarefas obtidas: ${allTasks.length}`);
        await connection.end();
    } catch (error) {
        console.error('Erro ao buscar tarefas:', error);
    }
}

async function handleCustomFields(task) {
    let pmo = 'N/A';
    let contratos = 'N/A';
    let servicos = 'N/A';
    let empresa = 'N/A';

    const ufCrmTask = task.ufCrmTask !== undefined ? String(task.ufCrmTask) : '';

    if (ufCrmTask) {
        const taskParts = ufCrmTask.split('_');
        const taskSuffix = taskParts[1]; // Valor após o "_"

        let entityTypeId = '';
        let fieldToFill = '';

        if (ufCrmTask.startsWith('T86_')) {
            entityTypeId = 134;
            fieldToFill = 'pmo';
        } else if (ufCrmTask.startsWith('Taf_')) {
            entityTypeId = 145;
            fieldToFill = 'contratos';
        } else if (ufCrmTask.startsWith('Tb9_')) {
            entityTypeId = 156;
            fieldToFill = 'servicos';
        }

        // 6. Verificação de `taskSuffix`
        if (entityTypeId && taskSuffix && !isNaN(taskSuffix)) {
            try {
                console.log(`Fetching title for ${fieldToFill} with ID: ${taskSuffix}`);
                const response = await axios.get(`https://interatell.bitrix24.com.br/rest/189/06s8ccs4p008cy4v/crm.${entityTypeId}.get.json`, {
                    params: { id: taskSuffix }
                });

                if (response.data.result && response.data.result.TITLE) {
                    const title = response.data.result.TITLE;
                    switch (fieldToFill) {
                        case 'pmo':
                            pmo = title;
                            break;
                        case 'contratos':
                            contratos = title;
                            break;
                        case 'servicos':
                            servicos = title;
                            break;
                        default:
                            break;
                    }

                    console.log(`Title for ${fieldToFill}: ${title}`);
                } else {
                    console.warn(`Resposta da API para ${fieldToFill} ID ${taskSuffix} não contém TITLE:`, response.data);
                }
            } catch (error) {
                console.error(`Erro ao buscar título para ${fieldToFill} com ID ${taskSuffix}:`, error.message);
            }
        }
    }

    if (ufCrmTask.includes('CO_')) {
        const companyId = ufCrmTask.split('CO_')[1];
        if (companyId) {
            console.log(`Fetching company title for ID: ${companyId}`);
            empresa = await fetchCompanyTitle(companyId);
            console.log(`Company Title: ${empresa}`);
        }
    }

    console.log(`Final values for task: PMO - ${pmo}, Contratos - ${contratos}, Serviços - ${servicos}, Empresa - ${empresa}`);
    return { pmo, contratos, servicos, empresa };
}

// Função para agendar as inserções
function scheduleTasks() {
    cron.schedule('0 7 * * *', fetchTasks);
    cron.schedule('0 13 * * *', fetchTasks);
    cron.schedule('30 16 * * *', fetchTasks);
    fetchTasks(); // Executar imediatamente na inicialização
}

// Chama a função de agendamento
scheduleTasks();
